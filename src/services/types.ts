/**
 * 서비스/화면에서 자주 쓰는 도메인 타입을 OpenAPI 스키마에서 재노출한다.
 * 새 타입이 필요하면 여기에 별칭을 추가하면 된다. (원본: src/types/api.d.ts)
 */
import type { Schemas } from '@/types/api-helpers';

// 계정 / 인증
export type Owner = Schemas['OwnerMe'];
export type OwnerUpdate = Schemas['OwnerUpdate'];
export type OwnerSignupRequest = Schemas['OwnerSignupRequest'];
export type OwnerLoginRequest = Schemas['OwnerLoginRequest'];
export type TokenPair = Schemas['TokenPair'];
export type BusinessVerification = Schemas['BusinessVerificationMe'];
export type BusinessVerificationSubmit = Schemas['BusinessVerificationSubmit'];

// 샵
export type Shop = Schemas['ShopMe'];
export type ShopCreate = Schemas['ShopCreate'];
export type ShopUpdate = Schemas['ShopUpdate'];
export type ShopVisibilityUpdate = Schemas['ShopVisibilityUpdate'];
export type BusinessHoursSet = Schemas['BusinessHoursSet'];
export type BusinessHourEntry = Schemas['BusinessHourEntry'];
export type ShopImage = Schemas['ShopImagePublic'];
export type ShopImageCreate = Schemas['ShopImageCreate'];

// 디자이너
export type Designer = Schemas['DesignerPublic'];
export type DesignerCreate = Schemas['DesignerCreate'];
export type DesignerUpdate = Schemas['DesignerUpdate'];
export type DesignerScheduleSet = Schemas['DesignerScheduleSet'];
export type ScheduleEntry = Schemas['ScheduleEntry'];
export type TimeOff = Schemas['TimeOffPublic'];
export type TimeOffCreate = Schemas['TimeOffCreate'];

// 디자인 / 옵션
export type Design = Schemas['DesignMe'];
export type DesignCreate = Schemas['DesignCreate'];
export type DesignUpdate = Schemas['DesignUpdate'];
export type DesignSortRequest = Schemas['DesignSortRequest'];
export type DesignFolder = Schemas['DesignFolderPublic'];
export type DesignFolderCreate = Schemas['DesignFolderCreate'];
export type DesignFolderUpdate = Schemas['DesignFolderUpdate'];
export type DesignDesigner = Schemas['DesignDesignerPublic'];
export type DesignOption = Schemas['DesignOptionPublic'];
export type DesignOptionCreate = Schemas['DesignOptionCreate'];
export type DesignOptionUpdate = Schemas['DesignOptionUpdate'];
export type DesignVisibilityUpdate = Schemas['DesignVisibilityUpdate'];

// 예약
export type Reservation = Schemas['ReservationOwner'];
export type ReservationStatus = Schemas['ReservationStatus'];
export type ReservationActionRequest = Schemas['ReservationActionRequest'];

// 리뷰
export type Review = Schemas['ReviewPublic'];
export type ReviewReplyCreate = Schemas['ReviewReplyCreate'];

// 문의 (앱에서 특정 디자인에 남긴 문의)
export type ShopInquiry = Schemas['ShopInquiryPublic'];
export type ShopInquiryReply = Schemas['ShopInquiryReply'];
export type InquiryStatus = Schemas['InquiryStatus'];

// 알림
export type OwnerNotification = Schemas['OwnerNotificationPublic'];
