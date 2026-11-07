"""Metered Anthropic execution: the ONE path every paid request takes.

All ten `messages.create` call sites get their client from `app.services.claude.get_client()`, which now returns a `MeteredClient`. A request is therefore subject to, in this order:

  1. KILL SWITCH   settings.AI_SPEND_ENABLED (default False): off -> nothing is ever sent, whatever else is configured.
  2. PRICE TABLE   a model that is not in PRICES is refused (no guessing at a price).
  3. PREFLIGHT     ceiling = estimated prompt cost + max_tokens x output price. The ceiling is RESERVED in the ledger before the request goes out,
                   under a Postgres advisory lock (phase) and a row lock on the reference video, so two concurrent calls cannot both squeeze under a cap.
                   spent + reserved + ceiling > cap  ->  refused (nothing sent): per reference (AI_PER_REFERENCE_BUDGET_USD) and per phase (AI_PHASE_BUDGET_USD).
  4. DUPLICATES    an identical request (same model/system/messages/max_tokens...) for the same reference that already SUCCEEDED is answered from the ledger at $0
                   (unless the caller is explicitly forcing a re-run, which is recorded); an identical request still IN FLIGHT is refused.
  5. RETRIES       the SDK's hidden retries are switched off (max_retries=0). We retry only transient errors (429/5xx/overloaded/connection), at most AI_RETRY_MAX times,
                   and EVERY attempt is its own ledger row reserved against the caps. Failed attempts cost 0 when the provider answered with an error status (not billed),
                   and the prompt cost when the outcome is unknown (connection loss/timeout) -- the conservative reading.
  6. SETTLEMENT    after a response the row is settled with the real `usage` (the unused part of the reservation is released). A reservation older than
                   RESERVED_TTL_SECONDS (a crashed process) is charged at its prompt cost only.

The ledger never stores prompts, images or keys. Any ledger/database error blocks the request (fail closed).
"""
from __future__ import annotations

import asyncio
import contextvars
import hashlib
import json
import logging
import math
from contextlib import contextmanager
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone

import anthropic
from sqlalchemy import select, text

from app.config import settings
from app.database import AsyncSessionLocal
from app.models.ai_call_ledger import AiCallLedger

logger = logging.getLogger(__name__)

PRICE_TABLE_VERSION = "2026-11-06"      # re-verify against the provider's pricing page before any real spend
RESERVED_TTL_SECONDS = 900
IMAGE_TOKENS_CEILING = 1600             # one image never costs more than ~1,568 visual tokens on the standard tier (28x28 patches, longest side capped)
CHARS_PER_TOKEN = 3.0                   # deliberately pessimistic (English ~4; code/JSON/other scripts need more tokens per character)
BACKOFF_SECONDS = (1.0, 3.0)


@dataclass(frozen=True)
class Price:
    in_: float          # USD per 1M input tokens
    out: float
    cache_read: float
    cache_write: float


def _p(i: float, o: float) -> Price:
    return Price(i, o, round(i * 0.1, 6), round(i * 1.25, 6))


# Official figures, platform.claude.com/docs/en/about-claude/pricing, 2026-11-06. Longest matching prefix wins (dated model ids).
PRICES: dict[str, Price] = {
    "claude-haiku-5-5": _p(0.10, 0.50), "claude-sonnet-5-5": _p(2, 10), "claude-sonnet-5": _p(2, 10),
    "claude-opus-5-5": _p(4, 20), "claude-opus-5": _p(5, 25), "claude-opus-4-8": _p(5, 25), "claude-opus-4-7": _p(5, 25), "claude-opus-4-6": _p(5, 25), "claude-opus-4-5": _p(5, 25),
    "claude-sonnet-4-6": _p(3, 15), "claude-sonnet-4-5": _p(3, 15), "claude-haiku-4-5": _p(1, 5),
}
HAIKU_55_LONG_PROMPT = _p(0.50, 2.50)    # Haiku 5.5 prompts over 100,000 tokens


def price_for(model: str | None, input_tokens: int = 0) -> Price | None:
    if not model:
        return None
    best = max((k for k in PRICES if model == k or model.startswith(k + "-")), key=len, default=None)
    if best is None:
        return None
    if best == "claude-haiku-5-5" and input_tokens > 100_000:
        return HAIKU_55_LONG_PROMPT
    return PRICES[best]


def estimate_input_tokens(kwargs: dict) -> int:
    """Pessimistic prompt size: characters / 3 for text, a fixed ceiling per image."""
    chars = 0
    images = 0

    def walk(x):
        nonlocal chars, images
        if isinstance(x, str):
            chars += len(x)
        elif isinstance(x, dict):
            if x.get("type") == "image":
                images += 1
                return
            for v in x.values():
                walk(v)
        elif isinstance(x, (list, tuple)):
            for v in x:
                walk(v)
        elif x is not None:
            chars += len(str(x))

    for key in ("system", "messages", "tools"):
        walk(kwargs.get(key))
    return math.ceil(chars / CHARS_PER_TOKEN) + images * IMAGE_TOKENS_CEILING


def ceiling_usd(price: Price, est_input_tokens: int, max_tokens: int) -> tuple[float, float]:
    est_in = est_input_tokens * price.in_ / 1_000_000
    return est_in, est_in + max_tokens * price.out / 1_000_000


def settled_cost_usd(model: str, usage) -> float:
    i = int(getattr(usage, "input_tokens", 0) or 0)
    o = int(getattr(usage, "output_tokens", 0) or 0)
    cr = int(getattr(usage, "cache_read_input_tokens", 0) or 0)
    cw = int(getattr(usage, "cache_creation_input_tokens", 0) or 0)
    p = price_for(model, i + cr + cw)
    if p is None:
        raise AiCostControlError("unknown_model", f"No price for model '{model}'.")
    return (i * p.in_ + o * p.out + cr * p.cache_read + cw * p.cache_write) / 1_000_000


def request_hash(kwargs: dict) -> str:
    return hashlib.sha256(json.dumps(kwargs, sort_keys=True, default=str).encode("utf-8")).hexdigest()


class AiCostControlError(anthropic.AnthropicError):
    """A request the cost controls refused (nothing was sent). Subclasses AnthropicError so the existing reasoner error handling turns it into their own domain error with this message."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


# ── scope: which reference / reasoner a request belongs to ───────────────────────────────

@dataclass(frozen=True)
class AiScope:
    reference_video_id: int | None = None
    video_analysis_id: int | None = None
    user_id: int | None = None
    reasoner: str = "unscoped"
    force: bool = False         # an explicit, user-requested re-run: an identical earlier answer is NOT reused (still counted and capped)


_scope: contextvars.ContextVar[AiScope] = contextvars.ContextVar("ai_scope", default=AiScope())


@contextmanager
def ai_scope(**changes):
    token = _scope.set(replace(_scope.get(), **changes))
    try:
        yield
    finally:
        _scope.reset(token)


def current_scope() -> AiScope:
    return _scope.get()


_last_success: contextvars.ContextVar[int | None] = contextvars.ContextVar("ai_last_success", default=None)


# ── ledger operations ─────────────────────────────────────────────────────────────────────

session_factory = AsyncSessionLocal      # tests substitute a NullPool factory


def _spent_sql(with_ref: bool) -> str:
    return ("SELECT COALESCE(SUM(CASE "
            " WHEN status = 'reserved' AND created_at >= :cut THEN reserved_usd "
            " WHEN status = 'reserved' THEN est_input_usd "
            " WHEN status IN ('succeeded', 'failed', 'invalid_output') THEN cost_usd ELSE 0 END), 0) FROM ai_call_ledger WHERE phase_id = :phase"
            + (" AND reference_video_id = :ref" if with_ref else ""))


async def _record_refusal(status: str, scope: AiScope, model: str, rhash: str, attempt: int, est_tokens: int, max_tokens: int, message: str) -> None:
    try:
        async with session_factory() as s:
            s.add(AiCallLedger(phase_id=settings.AI_PHASE_ID, user_id=scope.user_id, reference_video_id=scope.reference_video_id, video_analysis_id=scope.video_analysis_id,
                               reasoner=scope.reasoner, model=model or "?", request_hash=rhash, attempt_no=attempt, status=status, forced=scope.force,
                               est_input_tokens=est_tokens, max_output_tokens=max_tokens, error=message[:200], settled_at=datetime.now(timezone.utc)))
            await s.commit()
    except Exception:                    # noqa: BLE001 -- recording a refusal is best-effort; the refusal itself still stands
        logger.warning("Could not record an AI refusal in the ledger")


async def _reserve(scope: AiScope, model: str, rhash: str, attempt: int, est_tokens: int, est_in_usd: float, ceiling: float, max_tokens: int):
    """Returns ('reserved', row_id) | ('cache', response_json) | ('refused', (status, message))."""
    now = datetime.now(timezone.utc)
    cut = now - timedelta(seconds=RESERVED_TTL_SECONDS)
    phase = settings.AI_PHASE_ID
    async with session_factory() as s:
        async with s.begin():
            await s.execute(text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": f"ai-ledger:{phase}"})
            if scope.reference_video_id is not None:
                await s.execute(text("SELECT id FROM reference_videos WHERE id = :i FOR UPDATE"), {"i": scope.reference_video_id})

            same = select(AiCallLedger).where(AiCallLedger.request_hash == rhash, AiCallLedger.phase_id == phase,
                                              AiCallLedger.reference_video_id.is_(scope.reference_video_id) if scope.reference_video_id is None else AiCallLedger.reference_video_id == scope.reference_video_id)
            if attempt == 1 and not scope.force:
                prior = (await s.execute(same.where(AiCallLedger.status == "succeeded", AiCallLedger.response_json.is_not(None)).order_by(AiCallLedger.id.desc()).limit(1))).scalars().first()
                if prior is not None:
                    s.add(AiCallLedger(phase_id=phase, user_id=scope.user_id, reference_video_id=scope.reference_video_id, video_analysis_id=scope.video_analysis_id, reasoner=scope.reasoner,
                                       model=model, request_hash=rhash, attempt_no=attempt, status="cache_hit", est_input_tokens=est_tokens, max_output_tokens=max_tokens, settled_at=now))
                    return "cache", prior.response_json
            inflight = (await s.execute(same.where(AiCallLedger.status == "reserved", AiCallLedger.created_at >= cut).limit(1))).scalars().first()
            if inflight is not None:
                return "refused", ("duplicate_in_flight", "An identical AI request for this reference is already in progress. Wait for it to finish instead of sending it twice.")

            phase_spent = float((await s.execute(text(_spent_sql(False)), {"phase": phase, "cut": cut})).scalar_one())
            if phase_spent + ceiling > settings.AI_PHASE_BUDGET_USD:
                return "refused", ("refused_budget", f"The AI budget for this phase would be exceeded (spent about ${phase_spent:.2f} of ${settings.AI_PHASE_BUDGET_USD:.2f}; this request could cost up to ${ceiling:.2f}). Nothing was sent.")
            if scope.reference_video_id is not None:
                ref_spent = float((await s.execute(text(_spent_sql(True)), {"phase": phase, "cut": cut, "ref": scope.reference_video_id})).scalar_one())
                if ref_spent + ceiling > settings.AI_PER_REFERENCE_BUDGET_USD:
                    return "refused", ("refused_budget", f"The AI budget for this reference would be exceeded (spent about ${ref_spent:.2f} of ${settings.AI_PER_REFERENCE_BUDGET_USD:.2f}; this request could cost up to ${ceiling:.2f}). Nothing was sent.")

            row = AiCallLedger(phase_id=phase, user_id=scope.user_id, reference_video_id=scope.reference_video_id, video_analysis_id=scope.video_analysis_id, reasoner=scope.reasoner, model=model,
                               request_hash=rhash, attempt_no=attempt, status="reserved", forced=scope.force, est_input_tokens=est_tokens, max_output_tokens=max_tokens,
                               est_input_usd=est_in_usd, reserved_usd=ceiling)
            s.add(row)
            await s.flush()
            return "reserved", row.id


async def _settle(row_id: int, *, status: str, cost: float, usage=None, error: str | None = None, response_json: str | None = None) -> None:
    async with session_factory() as s:
        row = await s.get(AiCallLedger, row_id)
        if row is None:
            return
        row.status, row.cost_usd, row.settled_at, row.error, row.response_json = status, cost, datetime.now(timezone.utc), (error or None) and error[:200], response_json
        if usage is not None:
            row.input_tokens = int(getattr(usage, "input_tokens", 0) or 0)
            row.output_tokens = int(getattr(usage, "output_tokens", 0) or 0)
            row.cache_read_tokens = int(getattr(usage, "cache_read_input_tokens", 0) or 0)
            row.cache_write_tokens = int(getattr(usage, "cache_creation_input_tokens", 0) or 0)
        await s.commit()


def _classify_failure(exc: BaseException) -> tuple[bool, bool, str]:
    """(retryable, prompt_may_have_been_billed, short description)."""
    if isinstance(exc, anthropic.APIStatusError):
        code = exc.status_code
        return (code == 429 or code >= 500), False, f"{type(exc).__name__} {code}"   # an error STATUS from the provider is not billed
    if isinstance(exc, (anthropic.APITimeoutError, anthropic.APIConnectionError)):
        return True, True, type(exc).__name__                                        # outcome unknown: charge the prompt, conservatively
    return False, False, type(exc).__name__


async def metered_create(get_inner, kwargs: dict):
    """`get_inner` returns the real client; it is only called after the kill switch, price table and key checks, so a misconfigured or switched-off system refuses (and records the refusal) first."""
    scope = current_scope()
    model = kwargs.get("model") or ""
    max_tokens = int(kwargs.get("max_tokens") or 0)
    est_tokens = estimate_input_tokens(kwargs)
    rhash = request_hash(kwargs)

    if not settings.AI_SPEND_ENABLED:
        msg = "AI spending is switched off (AI_SPEND_ENABLED=false). Nothing was sent."
        await _record_refusal("refused_disabled", scope, model, rhash, 1, est_tokens, max_tokens, msg)
        raise AiCostControlError("disabled", msg)
    if kwargs.get("stream"):
        raise AiCostControlError("unsupported", "Streaming requests are not supported by the metered path.")
    price = price_for(model, est_tokens)
    if price is None:
        msg = f"The model '{model}' has no price in the cost table, so the request was refused. Nothing was sent."
        await _record_refusal("refused_model", scope, model, rhash, 1, est_tokens, max_tokens, msg)
        raise AiCostControlError("unknown_model", msg)
    if max_tokens <= 0:
        raise AiCostControlError("no_max_tokens", "A request without max_tokens has no cost ceiling, so it was refused.")
    est_in_usd, ceiling = ceiling_usd(price, est_tokens, max_tokens)
    try:
        inner = get_inner()
    except AiCostControlError as exc:
        await _record_refusal("refused_not_configured", scope, model, rhash, 1, est_tokens, max_tokens, str(exc))
        raise

    attempt = 0
    while True:
        attempt += 1
        try:
            kind, payload = await _reserve(scope, model, rhash, attempt, est_tokens, est_in_usd, ceiling, max_tokens)
        except AiCostControlError:
            raise
        except Exception as exc:         # noqa: BLE001 -- fail closed: no ledger, no request
            logger.error("AI ledger unavailable (%s); request blocked", type(exc).__name__)
            raise AiCostControlError("ledger_unavailable", "The AI cost ledger is unavailable, so the request was blocked. Nothing was sent.") from exc
        if kind == "cache":
            return anthropic.types.Message.model_validate_json(payload)
        if kind == "refused":
            status, msg = payload
            await _record_refusal(status, scope, model, rhash, attempt, est_tokens, max_tokens, msg)
            raise AiCostControlError(status, msg)
        row_id = payload
        try:
            message = await inner.messages.create(**kwargs)
        except asyncio.CancelledError:
            await asyncio.shield(_settle(row_id, status="failed", cost=est_in_usd, error="cancelled"))
            raise
        except Exception as exc:         # noqa: BLE001
            retryable, maybe_billed, what = _classify_failure(exc)
            await _settle(row_id, status="failed", cost=est_in_usd if maybe_billed else 0.0, error=what)
            if retryable and attempt <= settings.AI_RETRY_MAX:
                await asyncio.sleep(BACKOFF_SECONDS[min(attempt - 1, len(BACKOFF_SECONDS) - 1)])
                continue
            raise
        usage = getattr(message, "usage", None)
        try:
            cost = settled_cost_usd(model, usage)
        except AiCostControlError:
            cost = ceiling               # unreadable usage: keep the full reservation as the cost
        try:
            body = message.model_dump_json()
        except Exception:                # noqa: BLE001
            body = None
        await _settle(row_id, status="succeeded", cost=cost, usage=usage, response_json=body)
        _last_success.set(row_id)
        return message


class _Messages:
    def __init__(self, owner: "MeteredClient"):
        self._owner = owner

    async def create(self, **kwargs):
        return await metered_create(self._owner.inner, kwargs)


class MeteredClient:
    """Drop-in for the part of AsyncAnthropic this project uses (`.messages.create`)."""

    def __init__(self, inner=None):
        self._override = inner
        self._real = None
        self.messages = _Messages(self)

    def inner(self):
        if self._override is not None:
            return self._override
        if not settings.ANTHROPIC_API_KEY:
            raise AiCostControlError("not_configured", "No AI provider key is configured. Nothing was sent.")
        if self._real is None:
            self._real = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY, max_retries=0)   # no hidden retries: every attempt goes through the ledger
        return self._real


# ── admin view ────────────────────────────────────────────────────────────────────────────

async def usage_summary(limit: int = 50) -> dict:
    phase = settings.AI_PHASE_ID
    cut = datetime.now(timezone.utc) - timedelta(seconds=RESERVED_TTL_SECONDS)
    cost_expr = ("CASE WHEN status = 'reserved' AND created_at >= :cut THEN reserved_usd WHEN status = 'reserved' THEN est_input_usd "
                 "WHEN status IN ('succeeded','failed','invalid_output') THEN cost_usd ELSE 0 END")
    async with session_factory() as s:
        tot = (await s.execute(text(f"SELECT COALESCE(SUM({cost_expr}),0) spent, COUNT(*) FILTER (WHERE status IN ('succeeded','failed','reserved','invalid_output')) calls, "
                                    "COUNT(*) FILTER (WHERE status LIKE 'refused%') refused, COUNT(*) FILTER (WHERE status = 'cache_hit') cache_hits, "
                                    "COUNT(*) FILTER (WHERE status = 'failed') failed, COUNT(*) FILTER (WHERE status = 'reserved') in_flight, COUNT(*) FILTER (WHERE status = 'invalid_output') invalid "
                                    "FROM ai_call_ledger WHERE phase_id = :p"), {"p": phase, "cut": cut})).mappings().one()
        by_ref = (await s.execute(text(f"SELECT reference_video_id, SUM({cost_expr}) spent, COUNT(*) FILTER (WHERE status IN ('succeeded','failed','reserved','invalid_output')) calls "
                                       "FROM ai_call_ledger WHERE phase_id = :p GROUP BY reference_video_id ORDER BY spent DESC LIMIT 25"), {"p": phase, "cut": cut})).mappings().all()
        by_reasoner = (await s.execute(text(f"SELECT reasoner, model, SUM({cost_expr}) spent, COUNT(*) FILTER (WHERE status IN ('succeeded','failed','reserved','invalid_output')) calls, "
                                            "COALESCE(SUM(input_tokens),0) input_tokens, COALESCE(SUM(output_tokens),0) output_tokens "
                                            "FROM ai_call_ledger WHERE phase_id = :p GROUP BY reasoner, model ORDER BY spent DESC"), {"p": phase, "cut": cut})).mappings().all()
        recent = (await s.execute(select(AiCallLedger).where(AiCallLedger.phase_id == phase).order_by(AiCallLedger.id.desc()).limit(limit))).scalars().all()
    spent = float(tot["spent"] or 0)
    return {
        "enabled": settings.AI_SPEND_ENABLED, "key_configured": bool(settings.ANTHROPIC_API_KEY), "price_table_version": PRICE_TABLE_VERSION, "phase_id": phase,
        "caps": {"per_reference_usd": settings.AI_PER_REFERENCE_BUDGET_USD, "phase_usd": settings.AI_PHASE_BUDGET_USD},
        "phase": {"spent_usd": round(spent, 4), "remaining_usd": round(max(0.0, settings.AI_PHASE_BUDGET_USD - spent), 4), "calls": tot["calls"], "failed": tot["failed"],
                  "refused": tot["refused"], "cache_hits": tot["cache_hits"], "in_flight": tot["in_flight"], "invalid_replies": tot["invalid"]},
        "by_reference": [{"reference_video_id": r["reference_video_id"], "spent_usd": round(float(r["spent"] or 0), 4), "calls": r["calls"],
                          "remaining_usd": None if r["reference_video_id"] is None else round(max(0.0, settings.AI_PER_REFERENCE_BUDGET_USD - float(r["spent"] or 0)), 4)} for r in by_ref],
        "by_reasoner": [{"reasoner": r["reasoner"], "model": r["model"], "spent_usd": round(float(r["spent"] or 0), 4), "calls": r["calls"], "input_tokens": int(r["input_tokens"]), "output_tokens": int(r["output_tokens"])} for r in by_reasoner],
        "recent": [{"id": r.id, "at": r.created_at, "reasoner": r.reasoner, "reference_video_id": r.reference_video_id, "model": r.model, "attempt": r.attempt_no, "status": r.status,
                    "forced": r.forced, "input_tokens": r.input_tokens, "output_tokens": r.output_tokens, "cost_usd": round(r.cost_usd, 5), "reserved_usd": round(r.reserved_usd, 5), "error": r.error} for r in recent],
    }


# ── a paid reply that the reasoner then REJECTS (unparseable, or it breaks the contract) ──────────────────────────────

async def invalidate_last_success(reason: str) -> bool:
    """Marks the most recent successful reply of THIS task as `invalid_output`. It stays in the ledger (its cost is still counted, its text is kept) but is never served as a duplicate answer.
    Returns True if a reply was marked. A call that never reached the AI, or already failed, has nothing to mark."""
    row_id = _last_success.get()
    if row_id is None:
        return False
    try:
        async with session_factory() as s:
            res = await s.execute(text("UPDATE ai_call_ledger SET status = 'invalid_output', error = :r WHERE id = :i AND status = 'succeeded'"), {"i": row_id, "r": reason[:200]})
            await s.commit()
            _last_success.set(None)
            return bool(res.rowcount)
    except Exception:                    # noqa: BLE001 -- best effort; the request itself already failed
        logger.warning("Could not mark an invalid AI reply in the ledger")
        return False


async def note_last_success(note: str) -> None:
    """Records a harmless note (for example 'repaired: escaped 2 quotation marks') on the most recent successful reply."""
    row_id = _last_success.get()
    if row_id is None:
        return
    try:
        async with session_factory() as s:
            await s.execute(text("UPDATE ai_call_ledger SET error = :r WHERE id = :i AND status = 'succeeded'"), {"i": row_id, "r": note[:200]})
            await s.commit()
    except Exception:                    # noqa: BLE001
        pass


async def run_reasoner_call(fn, *, retry_once: bool = True):
    """Runs one reasoner provider call (`fn()` returns the awaitable). If the AI answered (and was paid) but the reasoner then REJECTED the reply, that reply is marked invalid (kept, counted, never reused)
    and, ONCE, the call is repeated as a forced fresh request (counted and capped like any other). A second rejection, or any other failure (an API error, a budget refusal, a kill switch), is raised as is:
    never a third try. Nothing is silently discarded: both replies stay in the ledger."""
    _last_success.set(None)
    try:
        return await fn()
    except AiCostControlError:
        raise
    except Exception as first:           # noqa: BLE001
        marked = await invalidate_last_success(f"rejected: {type(first).__name__}: {first}")
        if not (marked and retry_once):
            raise
        logger.info("AI reply rejected (%s); one fresh request follows", type(first).__name__)
        with ai_scope(force=True):
            _last_success.set(None)
            try:
                return await fn()
            except Exception as second:  # noqa: BLE001
                await invalidate_last_success(f"rejected again: {type(second).__name__}: {second}")
                raise
