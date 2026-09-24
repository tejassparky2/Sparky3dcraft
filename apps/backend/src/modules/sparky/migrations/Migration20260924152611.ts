import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260924152611 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "sparky_newsletter_subscriber" drop constraint if exists "sparky_newsletter_subscriber_email_unique";`);
    this.addSql(`create table if not exists "sparky_contact_message" ("id" text not null, "name" text null, "email" text not null, "phone" text null, "message" text not null, "status" text check ("status" in ('new', 'read', 'archived')) not null default 'new', "notified" boolean not null default false, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "sparky_contact_message_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_sparky_contact_message_deleted_at" ON "sparky_contact_message" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "sparky_customer_upload" ("id" text not null, "storage" text check ("storage" in ('local', 's3')) not null, "key" text not null, "filename" text not null, "mime" text not null, "size" integer not null, "sha256" text not null, "status" text check ("status" in ('pending', 'attached', 'deleted')) not null default 'pending', "cart_id" text null, "order_id" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "sparky_customer_upload_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_sparky_customer_upload_deleted_at" ON "sparky_customer_upload" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "sparky_newsletter_subscriber" ("id" text not null, "email" text not null, "status" text check ("status" in ('subscribed', 'unsubscribed')) not null default 'subscribed', "source" text not null default 'storefront-footer', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "sparky_newsletter_subscriber_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_sparky_newsletter_subscriber_deleted_at" ON "sparky_newsletter_subscriber" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_sparky_newsletter_subscriber_email_unique" ON "sparky_newsletter_subscriber" ("email") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "sparky_contact_message" cascade;`);

    this.addSql(`drop table if exists "sparky_customer_upload" cascade;`);

    this.addSql(`drop table if exists "sparky_newsletter_subscriber" cascade;`);
  }

}
