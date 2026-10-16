-- Additive: a review-only correction type for status / worked-hours / other concerns.
-- Approving it records the decision; it never revises the official attendance day.
ALTER TYPE "RegularizationRequestType" ADD VALUE 'OTHER';
