PYTHON ?= python
UV ?= uv
PYTHONPATH_RUN := PYTHONPATH=src

ifneq ("$(wildcard .venv/bin/python)","")
PYTHON := .venv/bin/python
endif

.PHONY: install install-dev format lint test check coverage run notify-test verify-once verify-loop

install:
	$(UV) pip install -r requirements.txt

install-dev: install
	$(UV) pip install -e .

format:
	$(PYTHON) -m ruff format src tests

lint:
	$(PYTHON) -m ruff check src tests
	$(PYTHON) -m mypy --strict

test:
	$(PYTHON) -m pytest

coverage:
	$(PYTHON) -m pytest --cov=us_amex_offer_hunter --cov-report=term-missing

check: format lint test

run:
	$(PYTHONPATH_RUN) $(PYTHON) -m us_amex_offer_hunter.cli.main

notify-test:
	$(PYTHONPATH_RUN) $(PYTHON) -m us_amex_offer_hunter.cli.main --notify-test

verify-once:
	$(PYTHONPATH_RUN) $(PYTHON) -m us_amex_offer_hunter.cli.main --verify-once

verify-loop:
	$(PYTHONPATH_RUN) $(PYTHON) -m us_amex_offer_hunter.cli.main --verify-loop

