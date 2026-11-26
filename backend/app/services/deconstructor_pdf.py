"""Render a readable summary and an optional, deduplicated evidence appendix."""
from io import BytesIO
from xml.sax.saxutils import escape


def render_report(snapshot: dict, include_appendix: bool = False) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate

    output = BytesIO()
    styles = getSampleStyleSheet()
    styles["Title"].textColor = colors.HexColor("#341657")
    styles["Heading2"].textColor = colors.HexColor("#542788")
    styles.add(ParagraphStyle("Entry", parent=styles["BodyText"], leading=13, spaceAfter=5))
    flow = []
    evidence = {}
    citations = {}

    def clean(value):
        return escape("".join(char for char in str(value or "") if char >= " " or char in "\t\n"))

    def add(value, style="Entry"):
        flow.append(Paragraph(value, styles[style]))

    def span(item):
        if item.get("start") is None:
            return ""
        end = item.get("end")
        return f" · {item['start']:.2f}s" + (f"–{end:.2f}s" if end is not None and end != item["start"] else "")

    def citation_refs(items):
        numbers = []
        for source in items:
            url = source.get("url")
            if url:
                numbers.append(citations.setdefault(url, (len(citations) + 1, source.get("title") or url))[0])
        return list(dict.fromkeys(numbers))

    def evidence_refs(items):
        numbers, sources = [], []
        for item in items:
            key = (item.get("kind"), item.get("id"), item.get("start"), item.get("end"), item.get("text"))
            numbers.append(evidence.setdefault(key, (len(evidence) + 1, item))[0])
            sources.extend(citation_refs(item.get("citations") or []))
        tags = [f"E{number}" for number in dict.fromkeys(numbers)] if include_appendix else []
        tags.extend(f"S{number}" for number in dict.fromkeys(sources))
        return f" <i>[{', '.join(tags)}]</i>" if tags else ""

    def entry(label, detail, item=None):
        item = item or {}
        confidence = f" · {item['confidence']} confidence" if item.get("confidence") else ""
        support = item.get("evidence")
        refs = evidence_refs(support) if isinstance(support, list) else ""
        cues = ""
        if isinstance(support, list) and not include_appendix:
            cues = ", ".join(dict.fromkeys(f"{source.get('kind', 'evidence')}{span(source)}" for source in support))
        add(f"<b>{clean(label)}</b>{clean(confidence)} · {clean(detail)}{refs}"
            + (f" <i>({clean(cues)})</i>" if cues else ""))

    add("Social Genius | Deconstructor Analysis", "Title")
    add(clean(snapshot.get("reference")), "Heading2")
    add("Evidence and recommendations for reference video analysis.")
    add("Source metadata and context", "Heading2")
    for label, value, classification in snapshot.get("metadata") or []:
        if value not in (None, "", "Unavailable"):
            entry(label, f"{value} · {classification}")
    for label, value in (snapshot.get("context") or {}).items():
        if value:
            entry(label, value)
    if snapshot.get("original_url"):
        entry("Original source", snapshot["original_url"])
    messaging = snapshot.get("messaging_report") or {}
    add("Messaging Intelligence", "Heading2")
    for name, finding in (messaging.get("findings") or {}).items():
        entry(name, finding.get("summary"), finding)
    for item in messaging.get("scenes") or []:
        scene = item.get("scene") or {}
        entry(f"Scene{span(scene)}", item.get("summary"), item)
    technical = snapshot.get("technical_report") or {}
    add("Technical Intelligence", "Heading2")
    for scene in technical.get("scenes") or []:
        label = f"Scene {scene['number']}{span(scene)}"
        entry(label, scene.get("summary") or "No summary available.")
    for item in technical.get("audio") or []:
        entry(f"{item.get('label', 'Audio')}{span(item)}", item.get("evidence"), item)
    for limitation in technical.get("limitations") or []:
        add(clean(limitation))
    discoverability = snapshot.get("discoverability_report") or {}
    add("Discoverability Intelligence", "Heading2")
    for section, entries in (discoverability.get("sections") or {}).items():
        add(clean(section), "Heading3")
        for item in entries:
            entry(item["label"], item.get("detail"), item)
    for dimension, report in (snapshot.get("research_reports") or {}).items():
        add(f"{clean(dimension)} research · {clean(report.get('topic'))}")
        for item in report.get("findings") or []:
            refs = ", ".join(f"S{number}" for number in citation_refs(item.get("citations") or []))
            if include_appendix:
                evidence_refs([{"kind": f"{dimension} research", **item}])
            elif refs:
                add(f"<i>[{refs}]</i> {clean(item.get('text'))}")

    if citations:
        add("Cited sources", "Heading2")
        for url, (number, title) in citations.items():
            add(f"<b>S{number}</b> · {clean(title)}<br/>{clean(url)}")

    if include_appendix:
        flow.append(PageBreak())
        add("Appendix | Detailed evidence", "Title")
        for shot in technical.get("shots") or []:
            add(clean(f"Shot {shot['number']}{span(shot)}"), "Heading2")
            for item in shot.get("findings") or []:
                entry(item["topic"], item.get("summary"), item)
            evidence_refs(shot.get("sources") or [])
        add("Speech and translations", "Heading2")
        for item in messaging.get("translations") or []:
            source = item.get("source") or {}
            entry(f"Translation{span(source)}", item.get("english"), {**item, "evidence": [source]})
        add("Evidence index", "Heading2")
        for number, item in evidence.values():
            entry(f"E{number} · {item.get('kind', 'Evidence')}{span(item)}", item.get("text"))
            if measurement := item.get("measurement"):
                add(clean(" · ".join(f"{key.replace('_', ' ')}: {value}" for key, value in measurement.items())))

    def footer(canvas, document):
        canvas.setFillColor(colors.HexColor("#542788"))
        canvas.setFont("Helvetica", 9)
        canvas.drawString(document.leftMargin, 30, "SOCIAL GENIUS  /  DECONSTRUCTOR")
        canvas.drawRightString(document.pagesize[0] - document.rightMargin, 30, str(document.page))

    SimpleDocTemplate(output, title="Social Genius Deconstructor Analysis", leftMargin=48,
                      rightMargin=48, topMargin=45, bottomMargin=46).build(flow, onFirstPage=footer, onLaterPages=footer)
    return output.getvalue()
