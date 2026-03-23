COOKIES ?= ./playwright/cookies.json
RESUMES ?= ./playwright/resumes.json
MAX ?= 40
MAX_ATTEMPTS ?= 160
MAX_FAIL_STREAK ?= 5
CONCURRENCY ?= 5
CHAT_MAX ?= 50
CHAT_MAX_DIALOGS ?= 100
CHAT_INTERVAL_MS ?= 1200

.PHONY: apply-5x40 chat-grok

apply-5x40:
	npm run start:pw:batch -- --resumes $(RESUMES) --cookies $(COOKIES) --max $(MAX) --maxAttempts $(MAX_ATTEMPTS) --maxFailStreak $(MAX_FAIL_STREAK) --concurrency $(CONCURRENCY)

chat-grok:
	@if test -z "$(AI_API_KEY)"; then echo "AI_API_KEY is required. Usage: AI_API_KEY=gsk_... make chat-grok"; exit 1; fi
	AI_API_KEY="$(AI_API_KEY)" npm run start:pw:chat -- --cookies $(COOKIES) --max $(CHAT_MAX) --maxDialogs $(CHAT_MAX_DIALOGS) --intervalMs $(CHAT_INTERVAL_MS)