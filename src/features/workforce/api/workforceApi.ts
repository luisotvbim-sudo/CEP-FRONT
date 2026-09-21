import { apiClient } from "../../../api/client";
import type {
  ExternalIdentityQuery,
  ExternalWorkforceIdentity,
  HistoryQuery,
  InviteWorkforcePersonInput,
  InviteWorkforcePersonResponse,
  PagedResponse,
  PeopleQuery,
  WorkforceAdminHistory,
  WorkforcePerson,
  WorkforceSync,
} from "../model/types";
import { buildExternalIdentityQuery, buildHistoryQuery, buildPeopleQuery } from "./query";

const base = "/api/v1/organization/time-control";

export const workforceApi = {
  latestSynchronization(signal?: AbortSignal) {
    return apiClient.request<WorkforceSync>(`${base}/synchronizations/latest`, { signal });
  },

  synchronization(batchId: string, signal?: AbortSignal) {
    return apiClient.request<WorkforceSync>(`${base}/synchronizations/${encodeURIComponent(batchId)}`, { signal });
  },

  synchronize(full = false) {
    return apiClient.request<WorkforceSync>(`${base}/synchronizations${full ? "?full=true" : ""}`, {
      method: "POST",
    });
  },

  identities(query: ExternalIdentityQuery, signal?: AbortSignal) {
    return apiClient.request<PagedResponse<ExternalWorkforceIdentity>>(
      `${base}/external-identities${buildExternalIdentityQuery(query)}`,
      { signal },
    );
  },

  invite(input: InviteWorkforcePersonInput) {
    return apiClient.request<InviteWorkforcePersonResponse>(`${base}/people/invitations`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  people(query: PeopleQuery, signal?: AbortSignal) {
    return apiClient.request<PagedResponse<WorkforcePerson>>(
      `${base}/people${buildPeopleQuery(query)}`,
      { signal },
    );
  },

  history(query: HistoryQuery, signal?: AbortSignal) {
    return apiClient.request<WorkforceAdminHistory>(`${base}/history${buildHistoryQuery(query)}`, { signal });
  },

  resendInvitation(invitationId: string) {
    return apiClient.request<void>(
      `/api/v1/organization/invitations/${encodeURIComponent(invitationId)}/resend`,
      { method: "POST" },
    );
  },
};
