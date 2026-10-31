"""Password rules for a NEW password (used by the reset flow). Returns user-facing messages; an empty list means acceptable."""
MIN_LENGTH = 12
MAX_BYTES = 72          # bcrypt only uses the first 72 bytes; reject longer input rather than silently truncating it


def validate_new_password(password: str, username: str = "", email: str | None = "") -> list[str]:
    errors: list[str] = []
    if len(password) < MIN_LENGTH:
        errors.append(f"Use at least {MIN_LENGTH} characters.")
    if len(password.encode("utf-8")) > MAX_BYTES:
        errors.append(f"Use at most {MAX_BYTES} bytes (long passwords with many accented or non-English characters can exceed this).")
    if password != password.strip():
        errors.append("Remove any spaces at the start or end.")
    if "\x00" in password:
        errors.append("The password contains an unsupported character.")
    email = email or ""
    same_as = {username.lower(), email.lower(), email.split("@")[0].lower()} - {""}
    if password.lower() in same_as:
        errors.append("Your password can't be the same as your username or email address.")
    return errors
