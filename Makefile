PYTHON ?= python
UV ?= uv
PYTHONPATH_RUN := PYTHONPATH=src
ITERATIONS ?= 5
INTERVAL_SEC ?= 5
COOLDOWN_SEC ?= 300
STOP_ON_HIT ?= 0
NOTIFY_ON_HIT ?= 0
PROFILE ?=
PROFILES ?=
LATEST ?= 0

ifneq ("$(wildcard .venv/bin/python)","")
PYTHON := .venv/bin/python
endif

.PHONY: install install-dev format lint test check coverage run notify-test verify verify-once verify-loop verify-once-debug verify-once-dump verify-summary verify-ab

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

verify: verify-once

verify-loop:
	$(PYTHONPATH_RUN) $(PYTHON) -m us_amex_offer_hunter.cli.main --verify-loop --iterations $(ITERATIONS) --interval-sec $(INTERVAL_SEC) $(if $(PROFILE),--profile $(PROFILE),) $(if $(filter 1,$(STOP_ON_HIT)),--stop-on-hit,) $(if $(filter 1,$(NOTIFY_ON_HIT)),--notify-on-hit,)

verify-summary:
	$(PYTHONPATH_RUN) $(PYTHON) -m us_amex_offer_hunter.cli.main --verify-summary --verify-log-path runs/verify_amounts.jsonl --latest $(LATEST)

verify-ab:
	$(PYTHONPATH_RUN) $(PYTHON) -m us_amex_offer_hunter.cli.main --verify-ab --profiles "$(PROFILES)" --iterations $(ITERATIONS) --interval-sec $(INTERVAL_SEC) --cooldown-sec $(COOLDOWN_SEC)

verify-once-debug:
	$(PYTHONPATH_RUN) $(PYTHON) -m us_amex_offer_hunter.cli.main --verify-once --dump-elements

verify-once-dump:
	$(PYTHONPATH_RUN) $(PYTHON) -m us_amex_offer_hunter.cli.main --verify-once --dump-elements --dump-page-source --dump-body-text

