import { useCallback, useEffect, useMemo, useState } from "react";
import { useFetcher, useLoaderData, useNavigate } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  DropZone,
  EmptyState,
  IndexTable,
  InlineStack,
  Layout,
  List,
  Modal,
  Page,
  ResourceItem,
  ResourceList,
  Spinner,
  Text,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server.js";
import {
  MAX_BULK_FILE_BYTES,
  MAX_BULK_ROWS,
} from "../utils/parseBulkFile.server.js";
import {
  SEO_DESCRIPTION_MAX,
  SEO_TITLE_MAX,
} from "../utils/seoValidation.js";
import { timeAgo } from "../utils/timeAgo.js";

const RECENT_JOBS_LIMIT = 5;

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  const recentJobs = await prisma.bulkJob.findMany({
    where: { shop: session.shop },
    orderBy: { createdAt: "desc" },
    take: RECENT_JOBS_LIMIT,
  });

  return {
    limits: {
      maxRows: MAX_BULK_ROWS,
      maxBytes: MAX_BULK_FILE_BYTES,
      titleMax: SEO_TITLE_MAX,
      descriptionMax: SEO_DESCRIPTION_MAX,
    },
    recentJobs: recentJobs.map((j) => ({
      id: j.id,
      fileName: j.fileName,
      totalRows: j.totalRows,
      successRows: j.successRows,
      failedRows: j.failedRows,
      status: j.status,
      createdAt: j.createdAt.toISOString(),
    })),
  };
};

function lengthBadgeTone(length, max) {
  if (length === 0) return "info";
  if (length > max) return "critical";
  if (length > max * 0.9) return "warning";
  return "success";
}

function validationBadge(level) {
  if (level === "valid") return <Badge tone="success">Valid</Badge>;
  if (level === "warning") return <Badge tone="warning">Warning</Badge>;
  return <Badge tone="critical">Error</Badge>;
}

function truncate(str, max = 60) {
  if (!str) return "";
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
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

export default function BulkUploadPage() {
  const { limits, recentJobs } = useLoaderData();
  const uploadFetcher = useFetcher();
  const navigate = useNavigate();

  const [pendingFile, setPendingFile] = useState(null);
  const [confirmStartOpen, setConfirmStartOpen] = useState(false);
  const [clientError, setClientError] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  const isUploading =
    uploadFetcher.state !== "idle" && uploadFetcher.formMethod === "POST";

  const data = dismissed ? null : uploadFetcher.data;
  const phase = data?.phase ?? "upload";
  const summary = data?.phase === "preview" ? data.summary : null;
  const fileName = data?.phase === "preview" ? data.fileName : null;

  const handleDrop = useCallback(
    (acceptedFiles) => {
      const file = acceptedFiles[0];
      if (!file) return;
      if (file.size > limits.maxBytes) {
        setClientError(
          `File is too large (${(file.size / 1024 / 1024).toFixed(2)} MB). Max ${(limits.maxBytes / 1024 / 1024).toFixed(0)} MB.`,
        );
        return;
      }
      setClientError(null);
      setDismissed(false);
      setPendingFile(file);
      const fd = new FormData();
      fd.set("file", file);
      uploadFetcher.submit(fd, {
        method: "POST",
        action: "/api/bulk/upload",
        encType: "multipart/form-data",
      });
    },
    [limits.maxBytes, uploadFetcher],
  );

  const submitConfirm = useCallback(() => {
    if (!pendingFile) return;
    setConfirmStartOpen(false);
    const fd = new FormData();
    fd.set("file", pendingFile);
    fd.set("confirm", "true");
    uploadFetcher.submit(fd, {
      method: "POST",
      action: "/api/bulk/upload",
      encType: "multipart/form-data",
    });
  }, [pendingFile, uploadFetcher]);

  const handleStart = useCallback(() => {
    if (!pendingFile) return;
    if (summary?.warning > 0) {
      setConfirmStartOpen(true);
      return;
    }
    submitConfirm();
  }, [pendingFile, summary, submitConfirm]);

  useEffect(() => {
    if (data?.phase === "started" && data.jobId) {
      navigate(`/app/bulk/${data.jobId}`);
    }
  }, [data, navigate]);

  const handleCancel = useCallback(() => {
    setPendingFile(null);
    setClientError(null);
    setDismissed(true);
  }, []);

  const tableMarkup = useMemo(() => {
    if (phase !== "preview") return null;
    const previewRows = data.rows;
    const rowMarkup = previewRows.map((row, index) => {
      const tone = row.validation.level === "error"
        ? "critical"
        : row.validation.level === "warning"
        ? "subdued"
        : undefined;
      return (
        <IndexTable.Row id={String(index)} key={index} position={index} tone={tone}>
          <IndexTable.Cell>{row.rowNumber}</IndexTable.Cell>
          <IndexTable.Cell>
            <Text as="span" variant="bodySm">
              {truncate(row.productUrl, 50)}
            </Text>
          </IndexTable.Cell>
          <IndexTable.Cell>
            <InlineStack gap="100" blockAlign="center" wrap={false}>
              <Text as="span" variant="bodySm">
                {truncate(row.metaTitle, 30)}
              </Text>
              <Badge tone={lengthBadgeTone(row.metaTitle.length, limits.titleMax)}>
                {String(row.metaTitle.length)}
              </Badge>
            </InlineStack>
          </IndexTable.Cell>
          <IndexTable.Cell>
            <InlineStack gap="100" blockAlign="center" wrap={false}>
              <Text as="span" variant="bodySm">
                {truncate(row.metaDescription, 40)}
              </Text>
              <Badge tone={lengthBadgeTone(row.metaDescription.length, limits.descriptionMax)}>
                {String(row.metaDescription.length)}
              </Badge>
            </InlineStack>
          </IndexTable.Cell>
          <IndexTable.Cell>{validationBadge(row.validation.level)}</IndexTable.Cell>
          <IndexTable.Cell>
            <Text as="span" variant="bodySm" tone="subdued">
              {row.validation.messages.join(" ")}
            </Text>
          </IndexTable.Cell>
        </IndexTable.Row>
      );
    });

    return (
      <IndexTable
        resourceName={{ singular: "row", plural: "rows" }}
        itemCount={previewRows.length}
        selectable={false}
        headings={[
          { title: "#" },
          { title: "Product URL" },
          { title: "Title" },
          { title: "Description" },
          { title: "Status" },
          { title: "Notes" },
        ]}
      >
        {rowMarkup}
      </IndexTable>
    );
  }, [phase, data, limits]);

  return (
    <Page
      backAction={{ content: "SEO Editor", url: "/app" }}
      title="Bulk SEO Update"
      primaryAction={{
        content: "Download template",
        url: "/api/bulk/template",
        external: true,
      }}
    >
      <TitleBar title="Bulk SEO Update" />
      <BlockStack gap="500">
        {clientError && (
          <Banner
            tone="critical"
            title="Could not accept file"
            onDismiss={() => setClientError(null)}
          >
            <p>{clientError}</p>
          </Banner>
        )}

        {phase === "error" && data?.message && (
          <Banner tone="critical" title="Could not process file">
            <p>{data.message}</p>
          </Banner>
        )}

        {phase !== "preview" && (
          <Layout>
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingMd">
                      Upload a spreadsheet
                    </Text>
                    <Text as="p" variant="bodyMd" tone="subdued">
                      Update SEO title and description for many products at
                      once. Drop an .xlsx or .csv with three columns:{" "}
                      <strong>product_url</strong>, <strong>meta_title</strong>,{" "}
                      <strong>meta_description</strong>.
                    </Text>
                  </BlockStack>

                  {isUploading ? (
                    <Box padding="600">
                      <BlockStack gap="200" inlineAlign="center">
                        <Spinner size="large" accessibilityLabel="Parsing file" />
                        <Text as="p" variant="bodyMd" tone="subdued">
                          Parsing {pendingFile?.name ?? "file"}…
                        </Text>
                      </BlockStack>
                    </Box>
                  ) : (
                    <DropZone
                      accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
                      type="file"
                      allowMultiple={false}
                      onDrop={handleDrop}
                    >
                      <DropZone.FileUpload
                        actionTitle="Add file"
                        actionHint="or drop your .xlsx or .csv here"
                      />
                    </DropZone>
                  )}
                </BlockStack>
              </Card>
            </Layout.Section>

            <Layout.Section variant="oneThird">
              <BlockStack gap="500">
                <Card>
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingMd">
                      Recent bulk jobs
                    </Text>
                    {recentJobs.length === 0 ? (
                      <EmptyState heading="" image="">
                        <p>Your bulk update history will appear here</p>
                      </EmptyState>
                    ) : (
                      <ResourceList
                        resourceName={{ singular: "job", plural: "jobs" }}
                        items={recentJobs}
                        renderItem={(job) => (
                          <ResourceItem
                            id={job.id}
                            onClick={() => navigate(`/app/bulk/${job.id}`)}
                            accessibilityLabel={`Open job ${job.fileName}`}
                          >
                            <BlockStack gap="100">
                              <InlineStack
                                align="space-between"
                                blockAlign="center"
                              >
                                <Text
                                  as="span"
                                  variant="bodyMd"
                                  fontWeight="semibold"
                                >
                                  {job.fileName}
                                </Text>
                                {jobStatusBadge(job.status)}
                              </InlineStack>
                              <Text as="span" variant="bodySm" tone="subdued">
                                {job.totalRows} rows · {job.successRows}{" "}
                                succeeded · {job.failedRows} failed ·{" "}
                                {timeAgo(job.createdAt)}
                              </Text>
                            </BlockStack>
                          </ResourceItem>
                        )}
                      />
                    )}
                  </BlockStack>
                </Card>
              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd">
                    Requirements
                  </Text>
                  <List type="bullet">
                    <List.Item>
                      Required column: <strong>product_url</strong> — a
                      storefront URL, admin URL, handle, numeric ID, or GID.
                    </List.Item>
                    <List.Item>
                      At least one of <strong>meta_title</strong> or{" "}
                      <strong>meta_description</strong> per row.
                    </List.Item>
                    <List.Item>Maximum {limits.maxRows} rows per file.</List.Item>
                    <List.Item>
                      Maximum file size{" "}
                      {(limits.maxBytes / 1024 / 1024).toFixed(0)} MB.
                    </List.Item>
                    <List.Item>
                      Recommended: title ≤ {limits.titleMax} chars,
                      description ≤ {limits.descriptionMax} chars.
                    </List.Item>
                  </List>
                </BlockStack>
              </Card>
              </BlockStack>
            </Layout.Section>
          </Layout>
        )}

        {phase === "preview" && summary && (
          <Layout>
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="100">
                      <Text as="h2" variant="headingMd">
                        Preview {fileName}
                      </Text>
                      <InlineStack gap="200">
                        <Badge>{`${summary.total} rows`}</Badge>
                        <Badge tone="success">{`${summary.valid} valid`}</Badge>
                        {summary.warning > 0 && (
                          <Badge tone="warning">{`${summary.warning} warnings`}</Badge>
                        )}
                        {summary.error > 0 && (
                          <Badge tone="critical">{`${summary.error} errors`}</Badge>
                        )}
                      </InlineStack>
                    </BlockStack>
                  </InlineStack>

                  {summary.error > 0 && (
                    <Banner tone="critical" title="Errors block the bulk update">
                      <p>
                        Fix the errored rows in your spreadsheet and re-upload.
                        See the Notes column for details.
                      </p>
                    </Banner>
                  )}

                  {tableMarkup}

                  <InlineStack align="end" gap="200">
                    <Button onClick={handleCancel} disabled={isUploading}>
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      onClick={handleStart}
                      loading={isUploading}
                      disabled={summary.error > 0 || !pendingFile}
                    >
                      Start bulk update
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>
        )}

        <Modal
          open={confirmStartOpen}
          onClose={() => setConfirmStartOpen(false)}
          title={`${summary?.warning ?? 0} warnings — continue anyway?`}
          primaryAction={{
            content: "Start anyway",
            onAction: submitConfirm,
          }}
          secondaryActions={[
            { content: "Cancel", onAction: () => setConfirmStartOpen(false) },
          ]}
        >
          <Modal.Section>
            <Text as="p" variant="bodyMd">
              Some rows have titles or descriptions over the recommended length.
              Shopify will still accept them, but search engines may truncate
              them.
            </Text>
          </Modal.Section>
        </Modal>
      </BlockStack>
    </Page>
  );
}

