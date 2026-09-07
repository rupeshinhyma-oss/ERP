import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { AttachmentList, type AttachmentItem } from "./AttachmentList";

describe("AttachmentList Preview Modal Lifecycle", () => {
  const sampleAttachments: AttachmentItem[] = [
    {
      id: "att-1",
      file_name: "architecture_diagram.png",
      file_url: "https://example.com/architecture_diagram.png",
      file_size: 204800,
      file_type: "image/png",
    },
    {
      id: "att-2",
      file_name: "project_specs.pdf",
      file_url: "https://example.com/project_specs.pdf",
      file_size: 1048576,
      file_type: "application/pdf",
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders attachment list items", () => {
    render(<AttachmentList attachments={sampleAttachments} />);
    expect(screen.getByText("architecture_diagram.png")).toBeTruthy();
    expect(screen.getByText("project_specs.pdf")).toBeTruthy();
  });

  it("opens Attachment Preview Modal on item click and closes on '✕' button click", () => {
    render(<AttachmentList attachments={sampleAttachments} />);
    
    // Initially preview modal is not open
    expect(screen.queryByTitle("Close preview")).toBeNull();

    // Click on the first attachment
    fireEvent.click(screen.getByText("architecture_diagram.png"));

    // Preview modal should now be open
    const closeBtn = screen.getByTitle("Close preview");
    expect(closeBtn).toBeTruthy();

    // Click close button
    fireEvent.click(closeBtn);

    // Modal should be closed
    expect(screen.queryByTitle("Close preview")).toBeNull();
  });

  it("closes Attachment Preview Modal on Escape key", () => {
    render(<AttachmentList attachments={sampleAttachments} />);
    
    // Open preview
    fireEvent.click(screen.getByText("project_specs.pdf"));
    expect(screen.getByTitle("Close preview")).toBeTruthy();

    // Press Escape
    fireEvent.keyDown(window, { key: "Escape" });

    // Modal should be closed
    expect(screen.queryByTitle("Close preview")).toBeNull();
  });
});
