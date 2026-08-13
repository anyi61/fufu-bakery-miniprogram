CREATE TABLE `integration_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` text,
	`provider` text NOT NULL,
	`operation` text NOT NULL,
	`reference` text NOT NULL,
	`status` text NOT NULL,
	`message` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_integration_order_created` ON `integration_events` (`order_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `orders` ADD `expires_at` text;