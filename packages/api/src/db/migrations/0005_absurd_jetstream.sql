CREATE TABLE `sessions` (
	`token` text PRIMARY KEY NOT NULL,
	`spotify_id` text NOT NULL,
	`user_id` integer NOT NULL,
	`is_admin` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
