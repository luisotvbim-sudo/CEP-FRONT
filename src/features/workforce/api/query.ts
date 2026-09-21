import type { ExternalIdentityQuery, HistoryQuery, PeopleQuery } from "../model/types";

function appendIfPresent(params: URLSearchParams, key: string, value: unknown) {
  if (value === undefined || value === null || value === "") return;
  params.set(key, String(value));
}

function toQueryString(params: URLSearchParams) {
  const value = params.toString();
  return value ? `?${value}` : "";
}

export function buildExternalIdentityQuery(query: ExternalIdentityQuery) {
  const params = new URLSearchParams();
  appendIfPresent(params, "source", query.source);
  appendIfPresent(params, "activeOnly", query.activeOnly);
  appendIfPresent(params, "mapped", query.mapped);
  appendIfPresent(params, "search", query.search?.trim());
  appendIfPresent(params, "page", query.page);
  appendIfPresent(params, "pageSize", query.pageSize);
  return toQueryString(params);
}

export function buildPeopleQuery(query: PeopleQuery) {
  const params = new URLSearchParams();
  appendIfPresent(params, "search", query.search?.trim());
  appendIfPresent(params, "page", query.page);
  appendIfPresent(params, "pageSize", query.pageSize);
  return toQueryString(params);
}

export function buildHistoryQuery(query: HistoryQuery) {
  const params = new URLSearchParams();
  appendIfPresent(params, "from", query.from);
  appendIfPresent(params, "to", query.to);
  appendIfPresent(params, "workforcePersonId", query.workforcePersonId);
  appendIfPresent(params, "source", query.source);
  appendIfPresent(params, "search", query.search?.trim());
  return toQueryString(params);
}
