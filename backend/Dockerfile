FROM python:3.12-slim
ARG CACHE_BUST=2
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg tesseract-ocr tesseract-ocr-eng tesseract-ocr-hin tesseract-ocr-urd tesseract-ocr-ara git curl build-essential libpq-dev && rm -rf /var/lib/apt/lists/*
ENV REFERENCE_OCR_ENGINE=tesseract
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && pip install --no-cache-dir -r requirements.txt
COPY . .
RUN mkdir -p uploads
EXPOSE 8000

CMD ["python", "-m", "app.main"]
