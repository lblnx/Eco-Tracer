FROM python:3.11-slim
WORKDIR /app
RUN pip install --no-cache-dir pytest
COPY src/ ./src/
COPY tests/ ./tests/
CMD ["pytest", "tests/"]