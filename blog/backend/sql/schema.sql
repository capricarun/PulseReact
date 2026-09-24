-- Marginal (blog): schema + demo content. Idempotent: safe to run more than once.
-- Fresh cluster: loaded by MySQL's init scripts (mysql-init ConfigMap).
-- Existing cluster: applied once by scripts/migrate-db.sh.
CREATE DATABASE IF NOT EXISTS blogdb CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE blogdb;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS posts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  slug VARCHAR(280) NOT NULL UNIQUE,
  body MEDIUMTEXT NOT NULL,
  excerpt VARCHAR(300),
  cover_image VARCHAR(500),
  tag VARCHAR(60) NOT NULL DEFAULT 'general',
  read_minutes INT NOT NULL DEFAULT 1,
  status ENUM('draft','published') NOT NULL DEFAULT 'published',
  author_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_posts_feed (status, created_at),
  INDEX idx_posts_tag (tag)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS comments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  post_id INT NOT NULL,
  author_id INT NOT NULL,
  body VARCHAR(1000) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_comments_post (post_id, created_at)
) ENGINE=InnoDB;

-- Demo author for the seed posts. The password hash is of a random value that was thrown away,
-- so nobody can sign in as this account on a public deployment.
INSERT INTO users (name, email, password_hash)
VALUES ('Ada Editorial', 'editor@blogapp.dev', '$2b$12$1X1q6Nc6Wgf40UaDaf.4o.iWAdIOPICWtw4HKlB7hdBV33kj0.UMa')
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO posts (title, slug, body, excerpt, tag, read_minutes, author_id)
SELECT seed.title, seed.slug, seed.body, seed.excerpt, seed.tag, seed.read_minutes, u.id
  FROM (
    SELECT 'Shipping to EKS Without Losing Sleep' AS title, 'shipping-to-eks-without-losing-sleep' AS slug,
           'A deep dive into building a resilient delivery pipeline for Kubernetes on AWS EKS, covering rolling updates, readiness probes, and automatic rollback when a release misbehaves.' AS body,
           'A deep dive into building a resilient delivery pipeline for Kubernetes on AWS EKS.' AS excerpt,
           'devops' AS tag, 6 AS read_minutes
    UNION ALL
    SELECT 'Why We Moved Artifact Storage to Nexus', 'why-we-moved-artifact-storage-to-nexus',
           'How centralizing Docker images and npm packages in Nexus Repository cut our build times and gave us a single source of truth for releases.',
           'How centralizing artifacts in Nexus cut our build times in half.', 'tooling', 4
    UNION ALL
    SELECT 'Static Analysis That Developers Actually Like', 'static-analysis-developers-actually-like',
           'Rolling out SonarQube quality gates without slowing teams down: practical thresholds, coverage on new code, and technical debt triage.',
           'Rolling out SonarQube quality gates without slowing teams down.', 'quality', 5
    UNION ALL
    SELECT 'Trivy in CI: Catching CVEs Before Production', 'trivy-in-ci-catching-cves-before-production',
           'A practical walkthrough of wiring Trivy image, secret and misconfiguration scans into a Jenkins pipeline with severity gating.',
           'A practical walkthrough of wiring Trivy scans into Jenkins.', 'security', 5
  ) AS seed
  JOIN users u ON u.email = 'editor@blogapp.dev'
ON DUPLICATE KEY UPDATE title = VALUES(title);
