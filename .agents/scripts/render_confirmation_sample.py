from pathlib import Path
import fitz

source = Path("attached_assets/AAKAR_SOLITAIRE_CONFIRMATION_1792116655585.pdf")
out = Path(".agents/outputs")
out.mkdir(parents=True, exist_ok=True)
doc = fitz.open(source)
print(f"{doc.page_count} pages")
for index, page in enumerate(doc):
    if index > 0:
        break
    image = page.get_pixmap(matrix=fitz.Matrix(1.6, 1.6), alpha=False)
    target = out / f"confirmation-sample-page-{index + 1}.png"
    image.save(target)
    print(target)
