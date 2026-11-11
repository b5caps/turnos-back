import { PrismaClient } from "@prisma/client";

function buildDatasourceUrl(): string | undefined {
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) return undefined;

  try {
    const url = new URL(rawUrl);
    if (!url.searchParams.has("connection_limit")) {
      url.searchParams.set("connection_limit", "20");
    }
    if (!url.searchParams.has("pool_timeout")) {
      url.searchParams.set("pool_timeout", "20");
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

const datasourceUrl = buildDatasourceUrl();

export const prisma = new PrismaClient(
  datasourceUrl ? { datasourceUrl } : undefined,
);

