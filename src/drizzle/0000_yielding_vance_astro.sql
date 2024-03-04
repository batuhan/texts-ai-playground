CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`timestamp` text DEFAULT CURRENT_TIMESTAMP,
	`edited_timestamp` text,
	`expires_in_seconds` integer,
	`sender_id` text,
	`text` text,
	`seen` integer,
	`is_delivered` integer,
	`is_hidden` integer,
	`is_sender` integer,
	`is_action` integer,
	`is_deleted` integer DEFAULT false,
	`is_errored` integer,
	`behavior` text,
	`account_id` text,
	`thread_id` text,
	`extra` text
);
--> statement-breakpoint
CREATE TABLE `participants` (
	`thread_id` text NOT NULL,
	`user_id` text NOT NULL,
	PRIMARY KEY(`thread_id`, `user_id`),
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `threads` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text,
	`is_unread` integer DEFAULT false,
	`last_read_message_id` text,
	`is_read_only` integer DEFAULT false,
	`is_archived` integer,
	`is_pinned` integer,
	`is_deleted` integer DEFAULT false,
	`type` text DEFAULT 'single',
	`timestamp` text DEFAULT CURRENT_TIMESTAMP,
	`img_url` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`description` text,
	`message_expiry_seconds` integer,
	`user_id` text,
	`extra` text
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text,
	`phone_number` text,
	`email` text,
	`full_name` text,
	`nickname` text,
	`img_url` text,
	`is_verified` integer,
	`cannot_message` integer,
	`is_self` integer,
	`provider_id` text
);
