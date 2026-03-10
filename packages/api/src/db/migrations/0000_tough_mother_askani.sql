CREATE TABLE `albums` (
	`spotify_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`image_url` text,
	`release_date` text,
	`total_tracks` integer,
	`album_type` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `artists` (
	`spotify_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`genres` text DEFAULT '[]',
	`image_url` text,
	`popularity` integer,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `auth_tokens` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`access_token` text NOT NULL,
	`refresh_token` text NOT NULL,
	`expires_at` text NOT NULL,
	`scope` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `listening_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`track_id` text NOT NULL,
	`played_at` text NOT NULL,
	`context_type` text,
	`context_uri` text,
	`duration_played_ms` integer,
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`spotify_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `listening_history_played_at_unique` ON `listening_history` (`played_at`);--> statement-breakpoint
CREATE INDEX `idx_listening_history_played_at` ON `listening_history` (`played_at`);--> statement-breakpoint
CREATE INDEX `idx_listening_history_track_id` ON `listening_history` (`track_id`);--> statement-breakpoint
CREATE TABLE `polling_state` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`last_recently_played_cursor` text,
	`last_poll_at` text,
	`last_currently_playing_track_id` text,
	`last_currently_playing_at` text
);
--> statement-breakpoint
CREATE TABLE `track_artists` (
	`track_id` text NOT NULL,
	`artist_id` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`track_id`, `artist_id`),
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`spotify_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`artist_id`) REFERENCES `artists`(`spotify_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tracks` (
	`spotify_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`album_id` text,
	`duration_ms` integer NOT NULL,
	`track_number` integer,
	`explicit` integer DEFAULT false,
	`popularity` integer,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`album_id`) REFERENCES `albums`(`spotify_id`) ON UPDATE no action ON DELETE no action
);
