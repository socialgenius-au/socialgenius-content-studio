"""Build a downloadable evidence report from an immutable analysis snapshot."""
from io import BytesIO
from xml.sax.saxutils import escape


def render_report(snapshot: dict) -> bytes:
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

    output = BytesIO()
    styles = getSampleStyleSheet()
    flow = []

    def paragraph(value, style="BodyText"):
        safe = "".join(char for char in str(value) if char >= " " or char in "\t\n")
        flow.append(Paragraph(escape(safe), styles[style]))
        flow.append(Spacer(1, 4))

    def contents(value, label=None):
        if isinstance(value, dict):
            if label:
                paragraph(label, "Heading3")
            for key, child in value.items():
                if key not in {"fingerprint", "sample_palette"}:
                    contents(child, key.replace("_", " ").capitalize())
        elif isinstance(value, list):
            if label and value:
                paragraph(label, "Heading3")
            for child in value:
                contents(child)
        elif value is not None:
            paragraph(f"{label}: {value}" if label else value)

    paragraph("Social Genius | Deconstructor Analysis", "Title")
    paragraph(snapshot["reference"])
    for key, title in (
        ("context", "Analysis context"), ("metadata", "Source metadata"), ("publication", "Published information"),
        ("messaging_report", "Messaging Intelligence"), ("technical_report", "Technical Intelligence"),
        ("discoverability_report", "Discoverability Intelligence"), ("research_reports", "Cited web research"),
        ("scenes", "Scene breakdown"), ("mechanisms", "Transferable mechanisms"),
    ):
        paragraph(title, "Heading2")
        if snapshot.get(key):
            contents(snapshot[key])
        else:
            paragraph("Unavailable")
    SimpleDocTemplate(output, title="Social Genius Deconstructor Analysis").build(flow)
    return output.getvalue()
