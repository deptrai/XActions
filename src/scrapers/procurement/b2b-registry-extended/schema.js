// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * B2B Registry Extended metadata schema for HoSoCongTy and MuaSamCong.
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

/** @type {string[]} */
export const HOSOCONGTY_FIELDS = [
  'taxCode',
  'companyName',
  'representativeName',
  'phone',
  'businessLines',
  'charterCapital',
  'establishedDate',
  'address',
  'legalForm',
  'status',
];

/** @type {string[]} */
export const MUASAMCONG_SEARCH_FIELDS = [
  'tenderNo',
  'tenderName',
  'procuringEntityName',
  'publishDate',
  'bidSubmissionDeadline',
  'bidStatus',
  'bidField',
  'bidLocation',
];

/** @type {string[]} */
export const MUASAMCONG_DETAIL_FIELDS = [
  'tenderNo',
  'publishDate',
  'planNo',
  'tenderName',
  'procuringEntityName',
  'bidValue',
  'bidSecurity',
  'bidField',
  'bidForm',
  'contractType',
  'bidMethod',
  'bidDuration',
  'bidSubmissionDeadline',
  'bidOpeningDate',
  'bidLocation',
];
