'use client';

import posthog from 'posthog-js';
import { config } from '@/lib/config';

type AnalyticsValue = string | number | boolean | null | undefined;
type AnalyticsProperties = Record<string, AnalyticsValue>;

export type OwnerAnalyticsEvent =
  | 'owner_login_succeeded'
  | 'reservation_status_changed'
  | 'design_sort_requested'
  | 'design_sort_completed';

let initialized = false;
let identityResolved = false;
let identifiedOwnerId: string | null = null;

export function initAnalytics(): boolean {
  if (!config.isBrowser || !config.analytics.enabled) return false;
  if (initialized) return true;

  posthog.init(config.analytics.posthogKey, {
    api_host: config.analytics.posthogHost,
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    capture_exceptions: false,
    capture_dead_clicks: false,
    capture_heatmaps: false,
    capture_performance: false,
    disable_session_recording: true,
    disable_surveys: true,
    advanced_disable_feature_flags: true,
    disable_external_dependency_loading: true,
    person_profiles: 'identified_only',
    request_batching: true,
  });
  initialized = true;
  return true;
}

export function captureAnalytics(
  event: OwnerAnalyticsEvent,
  properties: AnalyticsProperties = {},
): void {
  if (!initAnalytics()) return;
  posthog.capture(event, { surface: 'owner_web', ...properties });
}

export function capturePageView(pathname: string): void {
  if (!initAnalytics()) return;
  // 검색 파라미터와 해시는 보내지 않아 토큰·필터·검색어 유출을 막는다.
  posthog.capture('$pageview', {
    $current_url: `${window.location.origin}${pathname}`,
    $pathname: pathname,
    surface: 'owner_web',
  });
}

export function identifyAnalyticsOwner(ownerId: string): void {
  if (!ownerId || !initAnalytics()) return;
  if (identityResolved && identifiedOwnerId === ownerId) return;
  // 대표자명·이메일·전화번호는 person property로 저장하지 않는다.
  posthog.identify(ownerId);
  identifiedOwnerId = ownerId;
  identityResolved = true;
}

export function resetAnalytics(): void {
  if (!initialized) return;
  if (identityResolved && identifiedOwnerId === null) return;
  posthog.reset();
  identifiedOwnerId = null;
  identityResolved = true;
}
