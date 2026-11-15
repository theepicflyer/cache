CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'budget' NOT NULL,
	`icon` text DEFAULT '' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`opening_balance` integer DEFAULT 0 NOT NULL,
	`target` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_name` ON `categories` (lower("name"));--> statement-breakpoint
CREATE TABLE `monthly_amounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category_id` integer NOT NULL,
	`start_month` text NOT NULL,
	`amount` integer NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "monthly_amounts_not_negative" CHECK("monthly_amounts"."amount" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `monthly_amounts_category_month` ON `monthly_amounts` (`category_id`,`start_month`);--> statement-breakpoint
CREATE TABLE `recurring` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text DEFAULT 'expense' NOT NULL,
	`title` text NOT NULL,
	`amount` integer NOT NULL,
	`category_id` integer NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`every` integer DEFAULT 1 NOT NULL,
	`unit` text DEFAULT 'month' NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text,
	`month_offset` integer DEFAULT 0 NOT NULL,
	`paused` integer DEFAULT false NOT NULL,
	`last_generated` text,
	`created_by` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `warren_users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text DEFAULT 'expense' NOT NULL,
	`amount` integer NOT NULL,
	`title` text NOT NULL,
	`category_id` integer NOT NULL,
	`date` text NOT NULL,
	`month` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`recurring_id` integer,
	`created_by` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recurring_id`) REFERENCES `recurring`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `warren_users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "transactions_positive" CHECK("transactions"."amount" > 0)
);
--> statement-breakpoint
CREATE INDEX `transactions_month_category` ON `transactions` (`month`,`category_id`);--> statement-breakpoint
CREATE INDEX `transactions_date` ON `transactions` (`date`,`created_at`);