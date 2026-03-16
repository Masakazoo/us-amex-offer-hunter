PYTHON ?= python
UV ?= uv

.PHONY: install install-dev format lint test check coverage

install:
	$(UV) pip install -r requirements.txt

install-dev: install
	$(UV) pip install -e .

format:
	$(PYTHON) -m black src tests
	$(PYTHON) -m isort src tests

lint:
	$(PYTHON) -m ruff check src tests
	$(PYTHON) -m mypy --strict

test:
	$(PYTHON) -m pytest

coverage:
	$(PYTHON) -m pytest --cov=us_amex_offer_hunter --cov-report=term-missing

check: format lint test

