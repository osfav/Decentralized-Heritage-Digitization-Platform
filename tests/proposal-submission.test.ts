import { describe, it, expect, beforeEach } from "vitest";
import { buffCV, uintCV, stringAsciiCV, stringUtf8CV, someCV, noneCV } from "@stacks/transactions";

const ERR_UNAUTHORIZED = 100;
const ERR_INVALID_TITLE = 101;
const ERR_INVALID_DESCRIPTION = 102;
const ERR_INVALID_LOCATION = 103;
const ERR_INVALID_HERITAGE_TYPE = 104;
const ERR_INVALID_HASH = 105;
const ERR_PROPOSAL_NOT_FOUND = 106;
const ERR_PROPOSAL_EXISTS = 107;
const ERR_INVALID_STATUS_TRANSITION = 108;
const ERR_PROPOSAL_CLOSED = 109;

const STATUS_PENDING = "pending";
const STATUS_APPROVED = "approved";
const STATUS_REJECTED = "rejected";
const STATUS_IN_PROGRESS = "in-progress";
const STATUS_COMPLETED = "completed";

interface Proposal {
  title: string;
  description: string;
  location: string;
  heritageType: string;
  initialHash: Uint8Array;
  submitter: string;
  status: string;
  createdAt: bigint;
  updatedAt: bigint;
  verifiedAt: bigint | null;
  taskCount: bigint;
  nftMinted: boolean;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class ProposalSubmissionMock {
  state: {
    nextProposalId: bigint;
    proposals: Map<bigint, Proposal>;
    proposalByHash: Map<string, bigint>;
  } = {
    nextProposalId: 0n,
    proposals: new Map(),
    proposalByHash: new Map(),
  };
  blockHeight: bigint = 100n;
  caller: string = "ST1SUBMITTER";

  reset() {
    this.state = {
      nextProposalId: 0n,
      proposals: new Map(),
      proposalByHash: new Map(),
    };
    this.blockHeight = 100n;
    this.caller = "ST1SUBMITTER";
  }

  submitProposal(
    title: string,
    description: string,
    location: string,
    heritageType: string,
    initialHash: Uint8Array
  ): Result<bigint> {
    if (!title || title.length > 120) return { ok: false, value: ERR_INVALID_TITLE };
    if (!description || description.length > 2000) return { ok: false, value: ERR_INVALID_DESCRIPTION };
    if (!location || location.length > 100) return { ok: false, value: ERR_INVALID_LOCATION };
    if (!heritageType || heritageType.length > 50) return { ok: false, value: ERR_INVALID_HERITAGE_TYPE };
    if (initialHash.length !== 32) return { ok: false, value: ERR_INVALID_HASH };
    const hashKey = Buffer.from(initialHash).toString("hex");
    if (this.state.proposalByHash.has(hashKey)) return { ok: false, value: ERR_PROPOSAL_EXISTS };

    const id = this.state.nextProposalId;
    const proposal: Proposal = {
      title,
      description,
      location,
      heritageType,
      initialHash,
      submitter: this.caller,
      status: STATUS_PENDING,
      createdAt: this.blockHeight,
      updatedAt: this.blockHeight,
      verifiedAt: null,
      taskCount: 0n,
      nftMinted: false,
    };
    this.state.proposals.set(id, proposal);
    this.state.proposalByHash.set(hashKey, id);
    this.state.nextProposalId += 1n;
    return { ok: true, value: id };
  }

  getProposal(id: bigint): Proposal | null {
    return this.state.proposals.get(id) || null;
  }

  getProposalByHash(hash: Uint8Array): bigint | null {
    return this.state.proposalByHash.get(Buffer.from(hash).toString("hex")) || null;
  }

  updateProposalStatus(id: bigint, newStatus: string): Result<boolean> {
    const proposal = this.state.proposals.get(id);
    if (!proposal) return { ok: false, value: ERR_PROPOSAL_NOT_FOUND };
    if (proposal.submitter !== this.caller) return { ok: false, value: ERR_UNAUTHORIZED };
    if (![STATUS_PENDING, STATUS_APPROVED, STATUS_REJECTED, STATUS_IN_PROGRESS, STATUS_COMPLETED].includes(newStatus))
      return { ok: false, value: ERR_INVALID_STATUS_TRANSITION };
    if (proposal.status === STATUS_COMPLETED) return { ok: false, value: ERR_PROPOSAL_CLOSED };

    const validTransitions = {
      [STATUS_PENDING]: [STATUS_APPROVED, STATUS_REJECTED],
      [STATUS_APPROVED]: [STATUS_IN_PROGRESS],
      [STATUS_IN_PROGRESS]: [STATUS_COMPLETED],
    };
    if (!validTransitions[proposal.status]?.includes(newStatus))
      return { ok: false, value: ERR_INVALID_STATUS_TRANSITION };

    const updated = {
      ...proposal,
      status: newStatus,
      updatedAt: this.blockHeight,
      verifiedAt: newStatus === STATUS_COMPLETED ? this.blockHeight : proposal.verifiedAt,
    };
    this.state.proposals.set(id, updated);
    return { ok: true, value: true };
  }

  incrementTaskCount(id: bigint): Result<boolean> {
    const proposal = this.state.proposals.get(id);
    if (!proposal) return { ok: false, value: ERR_PROPOSAL_NOT_FOUND };
    if (proposal.status !== STATUS_IN_PROGRESS) return { ok: false, value: ERR_INVALID_STATUS_TRANSITION };
    this.state.proposals.set(id, { ...proposal, taskCount: proposal.taskCount + 1n, updatedAt: this.blockHeight });
    return { ok: true, value: true };
  }

  markNftMinted(id: bigint): Result<boolean> {
    const proposal = this.state.proposals.get(id);
    if (!proposal) return { ok: false, value: ERR_PROPOSAL_NOT_FOUND };
    if (proposal.nftMinted) return { ok: false, value: ERR_UNAUTHORIZED };
    this.state.proposals.set(id, { ...proposal, nftMinted: true, updatedAt: this.blockHeight });
    return { ok: true, value: true };
  }

  getNextProposalId(): Result<bigint> {
    return { ok: true, value: this.state.nextProposalId };
  }
}

describe("ProposalSubmission", () => {
  let mock: ProposalSubmissionMock;

  beforeEach(() => {
    mock = new ProposalSubmissionMock();
    mock.reset();
  });

  it("rejects duplicate hash", () => {
    const hash = new Uint8Array(32).fill(2);
    mock.submitProposal("A", "desc", "loc", "type", hash);
    const result = mock.submitProposal("B", "desc2", "loc", "type", hash);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_PROPOSAL_EXISTS);
  });

  it("rejects invalid title length", () => {
    const longTitle = "A".repeat(121);
    const result = mock.submitProposal(longTitle, "desc", "loc", "type", new Uint8Array(32));
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_TITLE);
  });

  it("updates status from pending to approved", () => {
    const hash = new Uint8Array(32).fill(3);
    mock.submitProposal("Test", "desc", "loc", "type", hash);
    const result = mock.updateProposalStatus(0n, STATUS_APPROVED);
    expect(result.ok).toBe(true);
    const proposal = mock.getProposal(0n);
    expect(proposal?.status).toBe(STATUS_APPROVED);
  });

  it("blocks invalid status transition", () => {
    const hash = new Uint8Array(32).fill(4);
    mock.submitProposal("Test", "desc", "loc", "type", hash);
    const result = mock.updateProposalStatus(0n, STATUS_IN_PROGRESS);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_STATUS_TRANSITION);
  });

  it("increments task count in progress", () => {
    const hash = new Uint8Array(32).fill(5);
    mock.submitProposal("Test", "desc", "loc", "type", hash);
    mock.updateProposalStatus(0n, STATUS_APPROVED);
    mock.updateProposalStatus(0n, STATUS_IN_PROGRESS);
    const result = mock.incrementTaskCount(0n);
    expect(result.ok).toBe(true);
    const proposal = mock.getProposal(0n);
    expect(proposal?.taskCount).toBe(1n);
  });

  it("marks NFT minted once", () => {
    const hash = new Uint8Array(32).fill(6);
    mock.submitProposal("Test", "desc", "loc", "type", hash);
    mock.updateProposalStatus(0n, STATUS_APPROVED);
    mock.updateProposalStatus(0n, STATUS_IN_PROGRESS);
    mock.updateProposalStatus(0n, STATUS_COMPLETED);
    const result = mock.markNftMinted(0n);
    expect(result.ok).toBe(true);
    const proposal = mock.getProposal(0n);
    expect(proposal?.nftMinted).toBe(true);
    const retry = mock.markNftMinted(0n);
    expect(retry.ok).toBe(false);
  });

  it("returns next proposal ID", () => {
    mock.submitProposal("A", "desc", "loc", "type", new Uint8Array(32).fill(7));
    const result = mock.getNextProposalId();
    expect(result.ok).toBe(true);
    expect(result.value).toBe(1n);
  });
});