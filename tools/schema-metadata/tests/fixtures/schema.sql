-- SYNTHETIC_PRIVATE_CANARY must never appear in a report or diagnostic.
/*!40101 SET NAMES utf8mb4 */;
DROP TABLE IF EXISTS `synthetic_transfer_hist`;
CREATE TABLE `synthetic_parent` (
  `id` bigint unsigned PRIMARY KEY,
  `code` varchar(20) NOT NULL UNIQUE
);
CREATE TABLE `synthetic_transfer_hist` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `requesttime` datetime NOT NULL,
  `reference` varchar(128) DEFAULT 'SYNTHETIC_PRIVATE_CANARY',
  `fromaccount` varchar(200) NULL COMMENT 'SYNTHETIC_PRIVATE_CANARY; ), CREATE TABLE fake (id INT)',
  `toaccount` varchar(200),
  `frommember` varchar(20),
  `amount` decimal(24,2) NOT NULL,
  `ccy` char(3),
  `result` enum('SYNTHETIC_PRIVATE_CANARY', 'SYNTHETIC_OTHER'),
  `parent_id` bigint unsigned,
  `seen_at` timestamp NULL,
  PRIMARY KEY (`id`, `requesttime`),
  UNIQUE KEY `reference_time` (`reference`, `requesttime`),
  KEY `sender_prefix` (`fromaccount`(10)),
  KEY `amount_desc` (`amount` DESC),
  CONSTRAINT `parent_link` FOREIGN KEY (`parent_id`) REFERENCES `synthetic_parent` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='SYNTHETIC_PRIVATE_CANARY';
