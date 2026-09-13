-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('user', 'editor', 'support', 'admin');

-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('free', 'premium');

-- CreateEnum
CREATE TYPE "LimitProfile" AS ENUM ('free', 'premium', 'staff');

-- CreateEnum
CREATE TYPE "ContentStatus" AS ENUM ('draft', 'published');

-- CreateEnum
CREATE TYPE "OverrideKind" AS ENUM ('allow', 'deny');

-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('started', 'scoring', 'scored', 'failed');

-- CreateEnum
CREATE TYPE "IdeaMatchStatus" AS ENUM ('enough', 'missing', 'off_topic');

-- CreateEnum
CREATE TYPE "SrsStatus" AS ENUM ('new', 'learning', 'review', 'mastered');

-- CreateEnum
CREATE TYPE "ReviewMode" AS ENUM ('flashcard', 'type', 'cloze');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMPTZ(6),
    "image" TEXT,
    "role" "Role" NOT NULL DEFAULT 'user',
    "plan" "Plan" NOT NULL DEFAULT 'free',
    "tos_accepted_at" TIMESTAMPTZ(6),
    "last_login_at" TIMESTAMPTZ(6),
    "onboarding_completed_at" TIMESTAMPTZ(6),
    "streak_count" INTEGER NOT NULL DEFAULT 0,
    "streak_last_date" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "session_token" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "expires" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMPTZ(6) NOT NULL
);

-- CreateTable
CREATE TABLE "tos_acceptances" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "accepted_at" TIMESTAMPTZ(6) NOT NULL,
    "tos_version" TEXT NOT NULL,
    "privacy_version" TEXT NOT NULL,
    "age_attested" BOOLEAN NOT NULL,

    CONSTRAINT "tos_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topics" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name_vi" TEXT NOT NULL,
    "status" "ContentStatus" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lemmas" (
    "id" UUID NOT NULL,
    "headword" TEXT NOT NULL,
    "headword_normalized" TEXT NOT NULL,
    "pos" TEXT,
    "phonetic" TEXT,
    "sense_vi" TEXT NOT NULL,
    "example_en" TEXT,
    "notes_vi" TEXT,
    "topic_id" UUID NOT NULL,
    "included_in_free" BOOLEAN NOT NULL DEFAULT false,
    "status" "ContentStatus" NOT NULL DEFAULT 'draft',
    "cefr" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "lemmas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompts" (
    "id" UUID NOT NULL,
    "external_key" TEXT,
    "text_vi" TEXT NOT NULL,
    "topic_id" UUID NOT NULL,
    "sample_en" TEXT,
    "hints_vi" TEXT,
    "status" "ContentStatus" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "prompts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_lemmas" (
    "prompt_id" UUID NOT NULL,
    "lemma_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "prompt_lemmas_pkey" PRIMARY KEY ("prompt_id","lemma_id")
);

-- CreateTable
CREATE TABLE "user_onboarding_topics" (
    "user_id" UUID NOT NULL,
    "topic_id" UUID NOT NULL,

    CONSTRAINT "user_onboarding_topics_pkey" PRIMARY KEY ("user_id","topic_id")
);

-- CreateTable
CREATE TABLE "user_topic_overrides" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "topic_id" UUID NOT NULL,
    "kind" "OverrideKind" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID NOT NULL,

    CONSTRAINT "user_topic_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_limits" (
    "profile" "LimitProfile" NOT NULL,
    "rewrite_new_per_day" INTEGER NOT NULL,
    "retry_per_day" INTEGER NOT NULL,
    "review_session_cap" INTEGER NOT NULL,
    "new_cards_used_natural_per_day" INTEGER,

    CONSTRAINT "plan_limits_pkey" PRIMARY KEY ("profile")
);

-- CreateTable
CREATE TABLE "plan_changes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "from_plan" "Plan" NOT NULL,
    "to_plan" "Plan" NOT NULL,
    "changed_by_id" UUID NOT NULL,
    "note" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rewrite_attempts" (
    "id" UUID NOT NULL,
    "attempt_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "parent_attempt_id" UUID,
    "user_id" UUID NOT NULL,
    "prompt_id" UUID NOT NULL,
    "status" "AttemptStatus" NOT NULL DEFAULT 'started',
    "user_en" TEXT,
    "prompt_text_vi_snapshot" TEXT NOT NULL,
    "sample_en_snapshot" TEXT NOT NULL,
    "targets_snapshot" JSONB NOT NULL,
    "topic_id_snapshot" UUID NOT NULL,
    "scored_at" TIMESTAMPTZ(6),
    "overall_score" INTEGER,
    "idea_match_status" "IdeaMatchStatus",
    "idea_match_comment_vi" TEXT,
    "feedback" JSONB,
    "display_issues" JSONB,
    "model" TEXT,
    "prompt_version" TEXT,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "cost_estimate_usd" DECIMAL(12,6),
    "latency_ms" INTEGER,
    "request_id" TEXT,
    "quota_charged" BOOLEAN NOT NULL DEFAULT false,
    "fail_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "rewrite_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "srs_cards" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "lemma_id" UUID NOT NULL,
    "status" "SrsStatus" NOT NULL DEFAULT 'new',
    "ef" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "repetitions" INTEGER NOT NULL DEFAULT 0,
    "interval_days" INTEGER NOT NULL DEFAULT 0,
    "next_review_at" TIMESTAMPTZ(6) NOT NULL,
    "hidden_at" TIMESTAMPTZ(6),
    "counted_toward_daily_new" BOOLEAN NOT NULL DEFAULT false,
    "added_from_attempt_id" UUID,
    "added_revision" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "srs_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "cap" INTEGER NOT NULL,
    "graded_count" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(6),

    CONSTRAINT "review_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "srs_reviews" (
    "id" UUID NOT NULL,
    "card_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "mode" "ReviewMode" NOT NULL,
    "quality" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "srs_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_daily_activity" (
    "user_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "rewrite_new_count" INTEGER NOT NULL DEFAULT 0,
    "review_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "user_daily_activity_pkey" PRIMARY KEY ("user_id","date")
);

-- CreateTable
CREATE TABLE "import_batches" (
    "id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "strict" BOOLEAN NOT NULL,
    "result" JSONB NOT NULL,
    "committed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_events" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "name" TEXT NOT NULL,
    "props" JSONB NOT NULL,
    "request_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT,
    "props" JSONB NOT NULL,
    "request_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "beta_allowlist_emails" (
    "email" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID NOT NULL
);

-- CreateTable
CREATE TABLE "quota_grants" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "extra_rewrite_new" INTEGER NOT NULL,
    "extra_retry" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quota_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "impersonation_sessions" (
    "id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "target_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "ended_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "impersonation_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "accounts_user_id_idx" ON "accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_provider_account_id_key" ON "accounts"("provider", "provider_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_session_token_key" ON "sessions"("session_token");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_token_key" ON "verification_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_identifier_token_key" ON "verification_tokens"("identifier", "token");

-- CreateIndex
CREATE INDEX "tos_acceptances_user_id_idx" ON "tos_acceptances"("user_id");

-- CreateIndex
CREATE INDEX "lemmas_topic_id_status_idx" ON "lemmas"("topic_id", "status");

-- CreateIndex
CREATE INDEX "prompts_topic_id_status_idx" ON "prompts"("topic_id", "status");

-- CreateIndex
CREATE INDEX "prompt_lemmas_lemma_id_idx" ON "prompt_lemmas"("lemma_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_topic_overrides_user_id_topic_id_key" ON "user_topic_overrides"("user_id", "topic_id");

-- CreateIndex
CREATE INDEX "plan_changes_user_id_idx" ON "plan_changes"("user_id");

-- CreateIndex
CREATE INDEX "rewrite_attempts_user_id_scored_at_idx" ON "rewrite_attempts"("user_id", "scored_at");

-- CreateIndex
CREATE INDEX "rewrite_attempts_user_id_prompt_id_idx" ON "rewrite_attempts"("user_id", "prompt_id");

-- CreateIndex
CREATE UNIQUE INDEX "rewrite_attempts_attempt_id_revision_key" ON "rewrite_attempts"("attempt_id", "revision");

-- CreateIndex
CREATE INDEX "srs_cards_user_id_next_review_at_idx" ON "srs_cards"("user_id", "next_review_at");

-- CreateIndex
CREATE UNIQUE INDEX "srs_cards_user_id_lemma_id_key" ON "srs_cards"("user_id", "lemma_id");

-- CreateIndex
CREATE INDEX "review_sessions_user_id_started_at_idx" ON "review_sessions"("user_id", "started_at");

-- CreateIndex
CREATE INDEX "srs_reviews_session_id_idx" ON "srs_reviews"("session_id");

-- CreateIndex
CREATE INDEX "srs_reviews_card_id_idx" ON "srs_reviews"("card_id");

-- CreateIndex
CREATE INDEX "analytics_events_name_created_at_idx" ON "analytics_events"("name", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_idx" ON "audit_logs"("actor_id");

-- CreateIndex
CREATE UNIQUE INDEX "beta_allowlist_emails_email_key" ON "beta_allowlist_emails"("email");

-- CreateIndex
CREATE INDEX "quota_grants_user_id_date_idx" ON "quota_grants"("user_id", "date");

-- CreateIndex
CREATE INDEX "impersonation_sessions_actor_id_ended_at_idx" ON "impersonation_sessions"("actor_id", "ended_at");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tos_acceptances" ADD CONSTRAINT "tos_acceptances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lemmas" ADD CONSTRAINT "lemmas_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompts" ADD CONSTRAINT "prompts_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_lemmas" ADD CONSTRAINT "prompt_lemmas_prompt_id_fkey" FOREIGN KEY ("prompt_id") REFERENCES "prompts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_lemmas" ADD CONSTRAINT "prompt_lemmas_lemma_id_fkey" FOREIGN KEY ("lemma_id") REFERENCES "lemmas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_onboarding_topics" ADD CONSTRAINT "user_onboarding_topics_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_topic_overrides" ADD CONSTRAINT "user_topic_overrides_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_topic_overrides" ADD CONSTRAINT "user_topic_overrides_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_changes" ADD CONSTRAINT "plan_changes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_changes" ADD CONSTRAINT "plan_changes_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rewrite_attempts" ADD CONSTRAINT "rewrite_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rewrite_attempts" ADD CONSTRAINT "rewrite_attempts_prompt_id_fkey" FOREIGN KEY ("prompt_id") REFERENCES "prompts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rewrite_attempts" ADD CONSTRAINT "rewrite_attempts_parent_attempt_id_fkey" FOREIGN KEY ("parent_attempt_id") REFERENCES "rewrite_attempts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "srs_cards" ADD CONSTRAINT "srs_cards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "srs_cards" ADD CONSTRAINT "srs_cards_lemma_id_fkey" FOREIGN KEY ("lemma_id") REFERENCES "lemmas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_sessions" ADD CONSTRAINT "review_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "srs_reviews" ADD CONSTRAINT "srs_reviews_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "srs_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "srs_reviews" ADD CONSTRAINT "srs_reviews_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "review_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_daily_activity" ADD CONSTRAINT "user_daily_activity_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beta_allowlist_emails" ADD CONSTRAINT "beta_allowlist_emails_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quota_grants" ADD CONSTRAINT "quota_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quota_grants" ADD CONSTRAINT "quota_grants_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "impersonation_sessions" ADD CONSTRAINT "impersonation_sessions_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "impersonation_sessions" ADD CONSTRAINT "impersonation_sessions_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- design §7.6 partial unique indexes
CREATE UNIQUE INDEX users_email ON users (lower(email));
CREATE UNIQUE INDEX topics_slug_alive ON topics (slug) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX lemmas_headword_alive ON lemmas (headword_normalized) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX prompts_external_key_alive ON prompts (external_key) WHERE deleted_at IS NULL AND external_key IS NOT NULL;
-- design §7.6 indexes
CREATE INDEX lemmas_topic_status ON lemmas (topic_id, status) WHERE deleted_at IS NULL;
CREATE INDEX prompts_topic_status ON prompts (topic_id, status) WHERE deleted_at IS NULL;
CREATE INDEX prompt_lemmas_lemma ON prompt_lemmas (lemma_id);
CREATE INDEX attempts_user_scored ON rewrite_attempts (user_id, scored_at) WHERE quota_charged = true;
CREATE INDEX attempts_user_prompt ON rewrite_attempts (user_id, prompt_id, scored_at);
CREATE INDEX cards_user_due ON srs_cards (user_id, next_review_at) WHERE hidden_at IS NULL;
CREATE INDEX cards_user_lemma ON srs_cards (user_id, lemma_id);
CREATE INDEX reviews_session ON srs_reviews (session_id);
CREATE INDEX events_name_created ON analytics_events (name, created_at);
CREATE INDEX audit_logs_action_created ON audit_logs (action, created_at);
CREATE INDEX quota_grants_user_date ON quota_grants (user_id, date);
CREATE UNIQUE INDEX impersonation_one_open_actor ON impersonation_sessions (actor_id) WHERE ended_at IS NULL;
-- design §7.6 checks
ALTER TABLE prompts ADD CONSTRAINT prompts_text_vi_len CHECK (char_length(text_vi) <= 500);
ALTER TABLE rewrite_attempts ADD CONSTRAINT attempts_user_en_len CHECK (user_en IS NULL OR char_length(user_en) <= 400);
ALTER TABLE rewrite_attempts ADD CONSTRAINT attempts_rev CHECK (revision IN (1, 2));
-- PRD §8 reference data
INSERT INTO plan_limits (profile, rewrite_new_per_day, retry_per_day, review_session_cap, new_cards_used_natural_per_day)
VALUES ('free', 10, 3, 20, 20), ('premium', 50, 10, 40, NULL), ('staff', 100, 10, 40, NULL);
