// Technology names the truth trace treats as "named tools" even when Your story never mentions them,
// so a draft cannot slip in "Kafka" or "Terraform" that the person never listed.
// The tools and skills in Your story are added on top of this list (see facts.ts). The list is not
// meant to be complete; it only has to catch the names a model is most likely to add.
// Spec: ARCHITECTURE.md section 8.2 rule 3.

export const KNOWN_TECHNOLOGIES: readonly string[] = [
  // Languages
  "Python", "JavaScript", "TypeScript", "Java", "Kotlin", "Scala", "Go", "Golang", "Rust", "C++", "C#",
  "Ruby", "PHP", "Swift", "Objective-C", "Dart", "Elixir", "Erlang", "Haskell", "Clojure", "MATLAB",
  "Perl", "Lua", "Bash", "PowerShell", "SQL", "HTML", "CSS", "GraphQL", "Solidity",

  // Frameworks and protocols
  "React", "React Native", "Next.js", "Vue", "Angular", "Svelte", "Redux", "Tailwind", "jQuery",
  "Node.js", "Express.js", "Django", "Flask", "FastAPI", "Spring Boot", "Ruby on Rails", "Rails",
  "Laravel", "ASP.NET", ".NET", "gRPC", "REST", "WebSockets", "OAuth", "JWT",

  // Data stores, queues and data tools
  "PostgreSQL", "Postgres", "MySQL", "SQLite", "MongoDB", "Redis", "Cassandra", "DynamoDB",
  "Elasticsearch", "OpenSearch", "Kafka", "RabbitMQ", "Kinesis", "Spark", "Hadoop", "Flink", "Airflow",
  "dbt", "Snowflake", "BigQuery", "Redshift", "Databricks", "Pandas", "NumPy", "Pinecone", "Memcached",
  "ClickHouse", "Neo4j", "Prisma", "Celery",

  // Cloud, infrastructure and delivery
  "Docker", "Kubernetes", "Helm", "Terraform", "Ansible", "Pulumi", "AWS", "GCP", "Azure", "Google Cloud",
  "EC2", "S3", "AWS Lambda", "CloudFormation", "Jenkins", "GitHub Actions", "GitLab CI", "CircleCI",
  "ArgoCD", "Prometheus", "Grafana", "Datadog", "Splunk", "OpenTelemetry", "Nginx", "Linux", "Envoy",
  "Istio", "HashiCorp Vault", "Cloudflare", "Vercel", "Heroku", "Firebase", "Supabase",

  // Source control, planning and payments
  "Git", "GitHub", "GitLab", "Jira", "Stripe", "Twilio",

  // Machine learning
  "PyTorch", "TensorFlow", "scikit-learn", "Hugging Face", "LangChain", "LlamaIndex", "CUDA",

  // Testing
  "Cypress", "Playwright", "Selenium", "Jest", "Pytest", "JUnit", "Vitest", "Mocha",
];

// Names above that are also everyday English words ("go", "rest", "spark"). They only count as a tool
// when written exactly as listed ("Go", not "go"), so "go-to person" or "the rest of the team" is not
// mistaken for a technology the person never used. Terms of one or two letters are treated the same way.
export const EVERYDAY_WORD_TECHNOLOGIES: readonly string[] = [
  "Go", "Swift", "Rust", "Spark", "Ray", "REST", "Rails", "Mocha", "Celery", "Pandas", "Cypress",
];
