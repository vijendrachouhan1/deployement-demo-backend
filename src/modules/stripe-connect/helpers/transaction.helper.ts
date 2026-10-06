import { StripeConnectTransactions } from "@/db/models/stripeConnect/transactions";
import {
  DELETED_PRODUCT_NAME,
  REFUND_ELIGIBILITY_DAYS,
} from "@/modules/stripe-connect/utils/stripe-connect.constant";
import {
  TCreateTransaction,
  TGetAllOrdersOptions,
  TGetAllTransactions,
  TGetTransactionDetails,
  TUpdateTransaction,
  ITransactionDetails,
} from "@/modules/stripe-connect/utils/stripe-connect.types";
import { TObjectId } from "@/types/common.types";
import { buildPaginatedResponse } from "@/helpers/pagination";
import { createFacetPipeline } from "@/helpers/query";
import { paymentGateway } from "@/providers/payment";
import { PAYMENT_STATUS } from "@/providers/payment/stripe/stripe.types";
import { PAGINATION } from "@/constants/pagination";
import {
  PLATFORM_FEE_PERCENTAGE,
  TRANSFER_STATUS,
} from "@/modules/stripe-connect/utils/stripe-connect.enum";
import { ObjectId } from "@/helpers/common";
import { emptyOrderCounts } from "@/modules/stripe-connect/utils/stripe-connect.util";

/** `stripeCustomerId` is the ownership key here; there is no userRef. */
export async function findOneOrder(id: TObjectId, stripeCustomerId?: string) {
  if (stripeCustomerId) {
    return StripeConnectTransactions.findOne({ _id: id, stripeCustomerId });
  }

  return StripeConnectTransactions.findById(id);
}

/**
 * Update a transaction
 */
export async function updateTransaction({ id, update }: TUpdateTransaction) {
  return StripeConnectTransactions.findByIdAndUpdate(
    id,
    { ...update },
    { new: true },
  );
}

/** Returns null when another request already claimed the refund. */
export async function claimOrderForRefund(id: TObjectId) {
  return StripeConnectTransactions.findOneAndUpdate(
    {
      _id: id,
      refunded: false,
      // The payout job clears `isRefundable` before it transfers, and
      // `createRefund` sends no `reverse_transfer`. Claiming on both fields
      // keeps a refund from being paid out of the platform balance when the
      // job wins the race against the window check above.
      isRefundable: true,
      transferStatus: TRANSFER_STATUS.PENDING,
    },
    { $set: { refunded: true, isRefundable: false } },
    { new: true },
  );
}

/** Undo a claim whose Stripe refund then failed, so a retry is possible. */
export async function releaseOrderRefundClaim(id: TObjectId) {
  return StripeConnectTransactions.updateOne(
    { _id: id },
    { $set: { refunded: false, isRefundable: true } },
  );
}

export async function refundOrder(id: TObjectId, chargeId: string) {
  const claimed = await claimOrderForRefund(id);

  if (!claimed) {
    return { refunded: false as const };
  }

  try {
    await paymentGateway.createRefund(chargeId);
  } catch (refundError) {
    await releaseOrderRefundClaim(id);
    throw refundError;
  }

  await updateTransaction({
    id,
    update: { paymentStatus: PAYMENT_STATUS.REFUNDED },
  });

  return { refunded: true as const };
}

/**
 * Create a new transaction
 */
export async function createTransaction(data: TCreateTransaction) {
  return StripeConnectTransactions.create(data);
}

/**
 * Get all orders for a customer with pagination and filtering
 */
export async function getAllOrders(
  stripeCustomerId: string,
  options: TGetAllOrdersOptions,
) {
  const {
    page = 1,
    pageSize = 3,
    filters = {},
    searchFilter,
    sorting,
    skips,
  } = options;

  const pipeline = [];
  let matchCondition = {
    stripeCustomerId,
    paymentStatus: { $ne: PAYMENT_STATUS.PENDING },
  };

  if (Object.keys(filters).length) {
    matchCondition = {
      ...matchCondition,
      ...filters,
    };
  }

  pipeline.push({
    $match: matchCondition,
  });

  pipeline.push(
    {
      $addFields: {
        daysSinceOrder: {
          $divide: [
            { $subtract: [new Date(), "$orderPlacedAt"] },
            1000 * 60 * 60 * 24, // Convert milliseconds to days
          ],
        },
      },
    },
    // Round the daysSinceOrder to a whole number
    {
      $addFields: {
        daysSinceOrder: { $floor: "$daysSinceOrder" },
      },
    },
    // Add a field to indicate refund eligibility
    {
      $addFields: {
        // Every condition refundOrder enforces, or the list offers a refund
        // the endpoint then rejects with a 409.
        isRefundEligible: {
          $and: [
            { $lte: ["$daysSinceOrder", REFUND_ELIGIBILITY_DAYS] },
            { $eq: ["$isRefundable", true] },
            { $eq: ["$refunded", false] },
            { $eq: ["$transferStatus", TRANSFER_STATUS.PENDING] },
            { $ne: [{ $ifNull: ["$stripeChargeId", null] }, null] },
          ],
        },
      },
    },
    // Lookup product details
    {
      $lookup: {
        from: "stripeconnectproducts",
        localField: "productRef",
        foreignField: "_id",
        as: "productDetails",
      },
    },
    // A deleted product must not take the order with it — the buyer can still
    // be inside the refund window for it.
    {
      $unwind: {
        path: "$productDetails",
        preserveNullAndEmptyArrays: true,
      },
    },
  );

  if (Object.keys(searchFilter).length > 0) {
    pipeline.push({
      $match: searchFilter,
    });
  }

  // add projection
  pipeline.push({
    $project: {
      _id: 1,
      productRef: 1,
      amountPaid: 1,
      orderPlacedAt: 1,
      isRefundEligible: 1,
      daysSinceOrder: 1,
      refunded: 1,
      productName: { $ifNull: ["$productDetails.title", DELETED_PRODUCT_NAME] },
      paymentStatus: 1,
      createdAt: 1,
    },
  });

  if (Object.keys(sorting).length) {
    pipeline.push({
      $sort: sorting,
    });
  }
  pipeline.push(...createFacetPipeline(page, skips, pageSize));

  const result = await StripeConnectTransactions.aggregate(pipeline);
  const data = result[0];

  return buildPaginatedResponse(data.items, {
    page: data.page,
    pageSize: data.pageSize,
    totalCount: data.total,
  });
}

export async function getAllOrdersCount(stripeCustomerId: string) {
  const result = await StripeConnectTransactions.aggregate([
    {
      $match: {
        stripeCustomerId,
        paymentStatus: { $ne: PAYMENT_STATUS.PENDING },
      },
    },
    {
      $lookup: {
        from: "stripeconnectproducts",
        localField: "productRef",
        foreignField: "_id",
        as: "productDetails",
      },
    },
    {
      $unwind: {
        path: "$productDetails",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $facet: {
        allPayments: [{ $count: "count" }],
        pending: [
          { $match: { paymentStatus: PAYMENT_STATUS.PENDING } },
          { $count: "count" },
        ],
        completed: [
          { $match: { paymentStatus: PAYMENT_STATUS.PAID } },
          { $count: "count" },
        ],
        refunded: [
          { $match: { paymentStatus: PAYMENT_STATUS.REFUNDED } },
          { $count: "count" },
        ],
      },
    },
    {
      $project: {
        allPayments: { $arrayElemAt: ["$allPayments.count", 0] },
        pending: { $arrayElemAt: ["$pending.count", 0] },
        completed: { $arrayElemAt: ["$completed.count", 0] },
        refunded: { $arrayElemAt: ["$refunded.count", 0] },
      },
    },
    {
      $addFields: {
        allPayments: { $ifNull: ["$allPayments", 0] },
        pending: { $ifNull: ["$pending", 0] },
        completed: { $ifNull: ["$completed", 0] },
        refunded: { $ifNull: ["$refunded", 0] },
      },
    },
  ]);

  return result[0] || emptyOrderCounts();
}

/**
 * Get all transactions for admin vendor
 */
export async function getAllTransactions(query: TGetAllTransactions) {
  const page = query.page || PAGINATION.DEFAULT_PAGE;
  const limit = query.pageSize || PAGINATION.DEFAULT_PAGE_SIZE;
  const skips = (page - 1) * limit;
  const stripeAccountId = query.stripeAccountId;

  const facetPipeline = createFacetPipeline(page, skips, limit);

  return StripeConnectTransactions.aggregate([
    { $match: { stripeAccountId } },
    {
      $project: {
        _id: 1,
        amountPaid: 1,
        paymentStatus: 1,
        orderPlacedAt: 1,
        refunded: 1,
        transferStatus: 1,
        amountRecoveryStatus: 1,
        productRef: 1,
        stripeCustomerId: 1,
      },
    },
    { $sort: { orderPlacedAt: -1 } },
    ...facetPipeline,
  ]);
}

/**
 * Update transaction by ID
 */
export async function updateTransactionById({
  id,
  update,
}: TUpdateTransaction) {
  return StripeConnectTransactions.findByIdAndUpdate(
    id,
    { ...update },
    { new: true },
  );
}

/**
 * Get transaction details with user and product information
 */
export async function getTransactionDetails(options: TGetTransactionDetails) {
  const {
    companyRef,
    page = 1,
    pageSize = 10,
    filters = {},
    searchFilter = {},
    sorting = {},
    skips = 0,
    stripeAccountId,
  } = options;

  const pipeline = [];

  const matchCondition = {
    companyRef: ObjectId(companyRef),
    stripeAccountId,
    ...filters,
  };

  // Add initial match stage if we have filters
  if (Object.keys(matchCondition).length > 0) {
    pipeline.push({ $match: matchCondition });
  }

  // Add joins
  pipeline.push(
    // join products
    {
      $lookup: {
        from: "stripeconnectproducts",
        localField: "productRef",
        foreignField: "_id",
        as: "product",
      },
    },
    { $unwind: "$product" },

    // join customer
    {
      $lookup: {
        from: "stripeconnectcustomers",
        localField: "stripeCustomerId",
        foreignField: "stripeCustomerId",
        as: "customer",
      },
    },
    { $unwind: "$customer" },

    // join user
    {
      $lookup: {
        from: "users",
        localField: "customer.userRef",
        foreignField: "_id",
        as: "user",
      },
    },
    { $unwind: "$user" },
  );

  if (Object.keys(searchFilter).length > 0) {
    pipeline.push({ $match: searchFilter });
  }

  // Add projection
  pipeline.push({
    $project: {
      _id: 1,
      buyerName: "$user.name",
      productName: "$product.title",
      price: {
        $multiply: ["$amountPaid", 1 - PLATFORM_FEE_PERCENTAGE.PERCENTAGE],
      },
      purchaseDate: "$orderPlacedAt",
      paymentStatus: 1,
      refunded: 1,
      createdAt: 1,
    },
  });

  if (Object.keys(sorting).length > 0) pipeline.push({ $sort: sorting });

  // Add pagination using the helper
  pipeline.push(...createFacetPipeline(page, skips, pageSize));

  // Execute the aggregation
  const result = await StripeConnectTransactions.aggregate(pipeline);

  // Extract the result from the facet structure
  const data = result[0];

  return buildPaginatedResponse<ITransactionDetails>(data.items, {
    page: data.page,
    pageSize: data.pageSize,
    totalCount: data.total,
  });
}

/**
 * Count transactions by status for a company
 */
export async function countTransactionByStatus(companyRef: string) {
  const result = await StripeConnectTransactions.aggregate([
    {
      $match: { companyRef: ObjectId(companyRef) },
    },

    {
      $lookup: {
        from: "stripeconnectproducts",
        localField: "productRef",
        foreignField: "_id",
        as: "product",
      },
    },
    { $unwind: "$product" },

    {
      $lookup: {
        from: "stripeconnectcustomers",
        localField: "stripeCustomerId",
        foreignField: "stripeCustomerId",
        as: "customer",
      },
    },
    { $unwind: "$customer" },

    {
      $lookup: {
        from: "users",
        localField: "customer.userRef",
        foreignField: "_id",
        as: "user",
      },
    },
    { $unwind: "$user" },
    {
      $facet: {
        allPayments: [{ $count: "count" }],
        pending: [
          { $match: { paymentStatus: PAYMENT_STATUS.PENDING } },
          { $count: "count" },
        ],
        completed: [
          { $match: { paymentStatus: PAYMENT_STATUS.PAID } },
          { $count: "count" },
        ],
        refunded: [
          { $match: { paymentStatus: PAYMENT_STATUS.REFUNDED } },
          { $count: "count" },
        ],
      },
    },
    {
      $project: {
        allPayments: { $arrayElemAt: ["$allPayments.count", 0] },
        pending: { $arrayElemAt: ["$pending.count", 0] },
        completed: { $arrayElemAt: ["$completed.count", 0] },
        refunded: { $arrayElemAt: ["$refunded.count", 0] },
      },
    },
    {
      $addFields: {
        allPayments: { $ifNull: ["$allPayments", 0] },
        pending: { $ifNull: ["$pending", 0] },
        completed: { $ifNull: ["$completed", 0] },
        refunded: { $ifNull: ["$refunded", 0] },
      },
    },
  ]);

  return result[0] || emptyOrderCounts();
}

/**
 * Get all transactions for super admin (includes stripe payment, stripe connect, stripe subscriptions etc.)
 */
export async function getSuperAdminTransactions(
  options: Partial<TGetTransactionDetails>,
) {
  const {
    page = 1,
    pageSize = 10,
    filters = {},
    searchFilter = {},
    sorting = {},
    skips = 0,
  } = options;

  const pipeline = [];

  // Add initial match stage if we have filters
  if (Object.keys(filters).length > 0) {
    pipeline.push({ $match: { ...filters } });
  }

  // Add joins
  pipeline.push(
    // join products
    {
      $lookup: {
        from: "stripeconnectproducts",
        localField: "productRef",
        foreignField: "_id",
        as: "product",
      },
    },
    { $unwind: "$product" },

    // join customer
    {
      $lookup: {
        from: "stripeconnectcustomers",
        localField: "stripeCustomerId",
        foreignField: "stripeCustomerId",
        as: "customer",
      },
    },
    { $unwind: "$customer" },

    // join user
    {
      $lookup: {
        from: "users",
        localField: "customer.userRef",
        foreignField: "_id",
        as: "user",
      },
    },
    { $unwind: "$user" },
    // join vendor
    {
      $lookup: {
        from: "users",
        localField: "product.userRef",
        foreignField: "_id",
        as: "vendor",
      },
    },
    { $unwind: "$vendor" },
  );

  if (Object.keys(searchFilter).length > 0) {
    pipeline.push({ $match: searchFilter });
  }

  pipeline.push({
    $project: {
      _id: 1,
      user: {
        name: { $concat: ["$user.name.first", " ", "$user.name.last"] },
        email: "$user.email",
      },
      product: {
        name: "$product.title",
        vendorId: "$product.userRef",
        price: "$product.price",
      },
      amount: "$amountPaid",
      purchaseDate: "$orderPlacedAt",
      vendor: {
        email: "$vendor.email",
        name: { $concat: ["$vendor.name.first", " ", "$vendor.name.last"] },
      },
      paymentStatus: 1,
      refunded: 1,
      createdAt: 1,
      transferStatus: 1,
    },
  });

  if (Object.keys(sorting).length > 0) pipeline.push({ $sort: sorting });

  pipeline.push(...createFacetPipeline(page, skips, pageSize));

  const result = await StripeConnectTransactions.aggregate(pipeline);

  const data = result[0];

  return buildPaginatedResponse(data.items, {
    page: data.page,
    pageSize: data.pageSize,
    totalCount: data.total,
  });
}

/**
 * Count all transactions for super admin
 */
export async function countSuperAdminTransactions() {
  const result = await StripeConnectTransactions.aggregate([
    {
      $lookup: {
        from: "stripeconnectproducts",
        localField: "productRef",
        foreignField: "_id",
        as: "product",
      },
    },
    { $unwind: "$product" },

    {
      $facet: {
        allPayments: [{ $count: "count" }],
        pending: [
          { $match: { paymentStatus: PAYMENT_STATUS.PENDING } },
          { $count: "count" },
        ],
        completed: [
          { $match: { paymentStatus: PAYMENT_STATUS.PAID } },
          { $count: "count" },
        ],
        refunded: [
          { $match: { paymentStatus: PAYMENT_STATUS.REFUNDED } },
          { $count: "count" },
        ],
      },
    },
    {
      $project: {
        allPayments: { $arrayElemAt: ["$allPayments.count", 0] },
        pending: { $arrayElemAt: ["$pending.count", 0] },
        completed: { $arrayElemAt: ["$completed.count", 0] },
        refunded: { $arrayElemAt: ["$refunded.count", 0] },
      },
    },
    {
      $addFields: {
        allPayments: { $ifNull: ["$allPayments", 0] },
        pending: { $ifNull: ["$pending", 0] },
        completed: { $ifNull: ["$completed", 0] },
        refunded: { $ifNull: ["$refunded", 0] },
      },
    },
  ]);

  return result[0];
}
