FROM python:3.12-slim
WORKDIR /app
COPY ledger.py .
ENV LEDGER_DIR=/data PYTHONUNBUFFERED=1
CMD ["python", "ledger.py"]
