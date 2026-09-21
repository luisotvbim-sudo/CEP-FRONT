export type WorkforceSource = "monday" | "vrMais";
export type SyncStatus = "running" | "succeeded" | "partiallySucceeded" | "failed";

export type PagedResponse<T> = {
  items: T[] | null;
  page: number;
  pageSize: number;
  total: number;
};

export type WorkforceSyncSource = {
  source: WorkforceSource;
  status: SyncStatus;
  receivedCount: number;
  createdCount: number;
  updatedCount: number;
  deactivatedCount: number;
  timeRecordReceivedCount: number;
  timeRecordCreatedCount: number;
  timeRecordUpdatedCount: number;
  timeRecordRemovedCount: number;
  completeSnapshot: boolean;
  coverageFrom: string | null;
  coverageTo: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
};

export type WorkforceSync = {
  id: string;
  status: SyncStatus;
  startedAt: string;
  completedAt: string | null;
  sources: WorkforceSyncSource[] | null;
};

export type ExternalWorkforceIdentity = {
  id: string;
  source: WorkforceSource;
  externalId: string | null;
  displayName: string | null;
  email: string | null;
  isActive: boolean;
  lastSeenAt: string;
  workforcePersonId: string | null;
};

export type Invitation = {
  id: string;
  email: string | null;
  role: "systemAdmin" | "organizationAdmin" | "user";
  canUseRevit: boolean;
  canUseZwcad: boolean;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
};

export type WorkforcePerson = {
  id: string;
  userId: string | null;
  displayName: string | null;
  email: string | null;
  monday: ExternalWorkforceIdentity;
  vrMais: ExternalWorkforceIdentity;
  invitationId: string | null;
  invitationExpiresAt: string | null;
  invitationAcceptedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InviteWorkforcePersonInput = {
  email: string;
  displayName: string;
  mondayIdentityId: string;
  vrMaisIdentityId: string;
};

export type InviteWorkforcePersonResponse = {
  person: WorkforcePerson;
  invitation: Invitation;
};

export type WorkforceTimeRecord = {
  id: string;
  source: WorkforceSource;
  externalKey: string | null;
  workDate: string;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  state: string | null;
  title: string | null;
  url: string | null;
  detailsJson: string | null;
  lastSyncedAt: string;
};

export type WorkforcePersonHistory = {
  workforcePersonId: string;
  userId: string | null;
  displayName: string | null;
  email: string | null;
  records: WorkforceTimeRecord[] | null;
};

export type WorkforceAdminHistory = {
  from: string;
  to: string;
  generatedAt: string;
  people: WorkforcePersonHistory[] | null;
};

export type ExternalIdentityQuery = {
  source?: WorkforceSource;
  activeOnly?: boolean;
  mapped?: boolean;
  search?: string;
  page?: number;
  pageSize?: number;
};

export type PeopleQuery = {
  search?: string;
  page?: number;
  pageSize?: number;
};

export type HistoryQuery = {
  from: string;
  to: string;
  workforcePersonId?: string;
  source?: WorkforceSource;
  search?: string;
};
