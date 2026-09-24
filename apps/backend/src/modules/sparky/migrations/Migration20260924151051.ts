import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260924151051 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "sparky_webhook_event" drop constraint if exists "sparky_webhook_event_provider_event_id_unique";`);
    this.addSql(`alter table if exists "sparky_source_mapping" drop constraint if exists "sparky_source_mapping_source_entity_type_source_id_unique";`);
    this.addSql(`create table if not exists "sparky_migration_run" ("id" text not null, "source" text not null, "mode" text not null, "status" text check ("status" in ('running', 'completed', 'failed')) not null default 'running', "stats" jsonb null, "error" text null, "finished_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "sparky_migration_run_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_sparky_migration_run_deleted_at" ON "sparky_migration_run" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "sparky_source_mapping" ("id" text not null, "source" text not null, "entity_type" text not null, "source_id" text not null, "source_handle" text null, "target_id" text not null, "source_updated_at" timestamptz null, "checksum" text null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "sparky_source_mapping_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_sparky_source_mapping_deleted_at" ON "sparky_source_mapping" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_sparky_source_mapping_source_entity_type_source_id_unique" ON "sparky_source_mapping" ("source", "entity_type", "source_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_sparky_source_mapping_entity_type_target_id" ON "sparky_source_mapping" ("entity_type", "target_id") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "sparky_webhook_event" ("id" text not null, "provider" text not null, "event_id" text not null, "event_type" text not null, "status" text check ("status" in ('received', 'dispatched', 'ignored', 'failed')) not null default 'received', "session_id" text null, "provider_reference" text null, "received_count" integer not null default 1, "error" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "sparky_webhook_event_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_sparky_webhook_event_deleted_at" ON "sparky_webhook_event" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_sparky_webhook_event_provider_event_id_unique" ON "sparky_webhook_event" ("provider", "event_id") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "sparky_migration_run" cascade;`);

    this.addSql(`drop table if exists "sparky_source_mapping" cascade;`);

    this.addSql(`drop table if exists "sparky_webhook_event" cascade;`);
  }

}
