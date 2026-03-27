COOKIES ?= ./playwright/cookies.json
RESUMES ?= ./playwright/resumes.json
MAX ?= 40
MAX_ATTEMPTS ?= 160
MAX_FAIL_STREAK ?= 5
CONCURRENCY ?= 5
QUERY ?=

.PHONY: apply-5x40

apply-5x40:
	npm run start:pw:batch -- --resumes $(RESUMES) --cookies $(COOKIES) --max $(MAX) --maxAttempts $(MAX_ATTEMPTS) --maxFailStreak $(MAX_FAIL_STREAK) --concurrency $(CONCURRENCY) $(if $(QUERY),--query "$(QUERY)",)