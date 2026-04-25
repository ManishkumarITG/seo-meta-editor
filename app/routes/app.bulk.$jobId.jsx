import { useEffect, useMemo, useRef, useState } from "react";
import { useLoaderData } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  IndexTable,
  InlineStack,
  Layout,
  Page,
  ProgressBar,
  Text,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server.js";
import { timeAgo } from "../utils/timeAgo.js";

const POLL_INTERVAL_MS = 1500;
const TERMINAL_STATUSES = new Set(["completed", "failed"]);

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const jobId = params.jobId;

  const job = await prisma.bulkJob.findUnique({
    where: { id: jobId },
    include: {
      rows: { orderBy: { rowNumber: "asc" } },
    },
  });

  if (!job || job.shop !== session.shop) {
    throw new Response("Job not found", { status: 404 });
  }

  return {
    job: {
      id: job.id,
      fileName: job.fileName,
      totalRows: job.totalRows,
      successRows: job.successRows,
      failedRows: job.failedRows,
      status: job.status,
      createdAt: job.createdAt.toISOString(),
      completedAt: job.completedAt ? job.completedAt.toISOString() : null,
    },
    rows: job.rows.map((r) => ({
      id: r.id,
      rowNumber: r.rowNumber,
      productUrl: r.productUrl,
      metaTitle: r.metaTitle,
      metaDescription: r.metaDescription,
      productId: r.productId,
      productTitle: r.productTitle,
      status: r.status,
      errorMessage: r.errorMessage,
      processedAt: r.processedAt ? r.processedAt.toISOString() : null,
    })),
  };
};

function statusBadge(status) {
  switch (status) {
    case "success":
      return <Badge tone="success">Success</Badge>;
    case "failed":
      return <Badge tone="critical">Failed</Badge>;
    case "processing":
      return <Badge tone="info">Processing</Badge>;
    case "skipped":
      return <Badge tone="warning">Skipped</Badge>;
    default:
      return <Badge>Pending</Badge>;
  }
}

function jobStatusBadge(status) {
  switch (status) {
    case "completed":
      return <Badge tone="success">Completed</Badge>;
    case "failed":
      return <Badge tone="critical">Failed</Badge>;
    case "processing":
      return <Badge tone="info">Processing</Badge>;
    default:
      return <Badge>Pending</Badge>;
  }
}

function truncate(str, max = 60) {
  if (!str) return "";
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}

export default function BulkJobPage() {
  const initial = useLoaderData();
  const [job, setJob] = useState(initial.job);
  const [rows, setRows] = useState(initial.rows);
  const pollRef = useRef(null);

  useEffect(() => {
    if (TERMINAL_STATUSES.has(job.status)) return undefined;

    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch(`/api/bulk/status/${initial.job.id}`, {
          credentials: "same-origin",
        });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setJob(data.job);
        setRows(data.rows);
      } catch {
        // swallow transient errors; next tick will retry
      }
    }

    pollRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [initial.job.id, job.status]);

  const counters = useMemo(() => {
    let success = 0;
    let failed = 0;
    let processing = 0;
    let pending = 0;
    for (const r of rows) {
      if (r.status === "success") success += 1;
      else if (r.status === "failed") failed += 1;
      else if (r.status === "processing") processing += 1;
      else pending += 1;
    }
    return { success, failed, processing, pending };
  }, [rows]);

  const processedCount = counters.success + counters.failed;
  const progressPct = job.totalRows > 0
    ? Math.round((processedCount / job.totalRows) * 100)
    : 0;
  const isTerminal = TERMINAL_STATUSES.has(job.status);

  const rowMarkup = rows.map((r, idx) => {
    const tone =
      r.status === "failed"
        ? "critical"
        : r.status === "processing"
        ? "subdued"
        : undefined;
    return (
      <IndexTable.Row id={r.id} key={r.id} position={idx} tone={tone}>
        <IndexTable.Cell>{r.rowNumber}</IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" variant="bodySm">
            {r.productTitle ? r.productTitle : truncate(r.productUrl, 50)}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>{statusBadge(r.status)}</IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" variant="bodySm" tone="subdued">
            {r.errorMessage ?? ""}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" variant="bodySm" tone="subdued">
            {r.processedAt ? timeAgo(r.processedAt) : "—"}
          </Text>
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  return (
    <Page
      backAction={{ content: "Bulk SEO Update", url: "/app/bulk" }}
      title={`Job ${job.id.slice(-8)} — ${job.fileName}`}
      titleMetadata={jobStatusBadge(job.status)}
      primaryAction={
        isTerminal && counters.failed > 0
          ? {
              content: "Download error report",
              url: `/api/bulk/${job.id}/errors.csv`,
              external: true,
            }
          : undefined
      }
    >
      <TitleBar title="Bulk job progress" />
      <BlockStack gap="500">
        {job.status === "failed" && (
          <Banner tone="critical" title="Job ended early">
            <p>
              Some rows may not have been processed. Use the error report to
              re-upload affected rows.
            </p>
          </Banner>
        )}

        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Progress
                  </Text>
                  <Text as="span" variant="bodyMd" tone="subdued">
                    {processedCount} / {job.totalRows} rows ({progressPct}%)
                  </Text>
                </InlineStack>
                <ProgressBar
                  progress={progressPct}
                  tone={
                    job.status === "failed"
                      ? "critical"
                      : job.status === "completed"
                      ? "success"
                      : "primary"
                  }
                />
                <Text as="p" variant="bodySm" tone="subdued">
                  {isTerminal
                    ? `Finished ${job.completedAt ? timeAgo(job.completedAt) : ""}.`
                    : "Live updates every 1.5 seconds…"}
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        <Layout>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm" tone="subdued">
                  Succeeded
                </Text>
                <InlineStack gap="200" blockAlign="center">
                  <Text as="p" variant="heading2xl">
                    {counters.success}
                  </Text>
                  <Badge tone="success">success</Badge>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm" tone="subdued">
                  Failed
                </Text>
                <InlineStack gap="200" blockAlign="center">
                  <Text as="p" variant="heading2xl">
                    {counters.failed}
                  </Text>
                  <Badge tone="critical">failed</Badge>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm" tone="subdued">
                  Pending
                </Text>
                <InlineStack gap="200" blockAlign="center">
                  <Text as="p" variant="heading2xl">
                    {counters.pending + counters.processing}
                  </Text>
                  <Badge>{counters.processing > 0 ? "in flight" : "queued"}</Badge>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        <Layout>
          <Layout.Section>
            <Card padding="0">
              <Box padding="400">
                <Text as="h2" variant="headingMd">
                  Rows
                </Text>
              </Box>
              <IndexTable
                resourceName={{ singular: "row", plural: "rows" }}
                itemCount={rows.length}
                selectable={false}
                headings={[
                  { title: "#" },
                  { title: "Product" },
                  { title: "Status" },
                  { title: "Error" },
                  { title: "Processed" },
                ]}
              >
                {rowMarkup}
              </IndexTable>
            </Card>
          </Layout.Section>
        </Layout>

        <InlineStack align="end">
          <Button url="/app/bulk">Back to dashboard</Button>
        </InlineStack>
      </BlockStack>
    </Page>
  );
}
