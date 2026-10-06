import { UserQuery } from "@/db/models/userQuery";
import {
  USER_QUERY_STATUS,
  USER_QUERY_SUBJECT,
} from "@/modules/user-query/utils/user-query.enum";
import mongoose from "mongoose";

const MONGO_URI = "mongodb://localhost:27017/boilerplate";

// npx ts-node -r tsconfig-paths/register user-queries.ts

// Helper: random date in last 2 months
function randomDateWithinLastTwoMonths(): Date {
  const now = new Date();
  const twoMonthsAgo = new Date();
  twoMonthsAgo.setMonth(now.getMonth() - 2);

  return new Date(
    twoMonthsAgo.getTime() +
      Math.random() * (now.getTime() - twoMonthsAgo.getTime()),
  );
}

async function seed() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("✅ Connected to MongoDB");

    const userRef = new mongoose.Types.ObjectId("68a2b074c9d95353312802c5");
    const companyRef = new mongoose.Types.ObjectId("689188c6324a6a1f36ca5889");

    const queries = [
      {
        name: { first: "Alice", last: "Johnson" },
        email: "alice.johnson@example.com",
        subject: USER_QUERY_SUBJECT.BILLING,
        message: "I need help with my latest invoice.",
        userRef,
        companyRef,
        status: USER_QUERY_STATUS.PENDING,
        createdAt: randomDateWithinLastTwoMonths(),
        updatedAt: new Date(),
      },
      {
        name: { first: "Bob", last: "Smith" },
        email: "bob.smith@example.com",
        subject: USER_QUERY_SUBJECT.TECHNICAL,
        message: "My account was locked. Can you assist?",
        userRef,
        companyRef,
        status: USER_QUERY_STATUS.IN_PROGRESS,
        createdAt: randomDateWithinLastTwoMonths(),
        updatedAt: new Date(),
      },
      {
        name: { first: "Charlie", last: "Davis" },
        email: "charlie.davis@example.com",
        subject: USER_QUERY_SUBJECT.FEATURE,
        message: "Please add a dark mode option in the app.",
        userRef,
        companyRef,
        status: USER_QUERY_STATUS.RESOLVED,
        createdAt: randomDateWithinLastTwoMonths(),
        updatedAt: new Date(),
      },
      {
        name: { first: "Diana", last: "Miller" },
        email: "diana.miller@example.com",
        subject: USER_QUERY_SUBJECT.GENERAL,
        message: "What are your customer support hours?",
        userRef,
        companyRef,
        status: USER_QUERY_STATUS.PENDING,
        createdAt: randomDateWithinLastTwoMonths(),
        updatedAt: new Date(),
      },
      {
        name: { first: "Ethan", last: "Brown" },
        email: "ethan.brown@example.com",
        subject: USER_QUERY_SUBJECT.BILLING,
        message: "I was charged twice this month. Can you fix it?",
        userRef,
        companyRef,
        status: USER_QUERY_STATUS.IN_PROGRESS,
        createdAt: randomDateWithinLastTwoMonths(),
        updatedAt: new Date(),
      },
      {
        name: { first: "Fiona", last: "Wilson" },
        email: "fiona.wilson@example.com",
        subject: USER_QUERY_SUBJECT.TECHNICAL,
        message: "My password reset email never arrived.",
        userRef,
        companyRef,
        status: USER_QUERY_STATUS.PENDING,
        createdAt: randomDateWithinLastTwoMonths(),
        updatedAt: new Date(),
      },
      {
        name: { first: "George", last: "Clark" },
        email: "george.clark@example.com",
        subject: USER_QUERY_SUBJECT.FEATURE,
        message: "Great support team, but please add multi-language support.",
        userRef,
        companyRef,
        status: USER_QUERY_STATUS.RESOLVED,
        createdAt: randomDateWithinLastTwoMonths(),
        updatedAt: new Date(),
      },
      {
        name: { first: "Hannah", last: "Lopez" },
        email: "hannah.lopez@example.com",
        subject: USER_QUERY_SUBJECT.GENERAL,
        message: "How do I permanently delete my account?",
        userRef,
        companyRef,
        status: USER_QUERY_STATUS.CLOSED,
        createdAt: randomDateWithinLastTwoMonths(),
        updatedAt: new Date(),
      },
      {
        name: { first: "Ian", last: "Walker" },
        email: "ian.walker@example.com",
        subject: USER_QUERY_SUBJECT.TECHNICAL,
        message: "The dashboard loads very slowly for me.",
        userRef,
        companyRef,
        status: USER_QUERY_STATUS.IN_PROGRESS,
        createdAt: randomDateWithinLastTwoMonths(),
        updatedAt: new Date(),
      },
      {
        name: { first: "Julia", last: "Martinez" },
        email: "julia.martinez@example.com",
        subject: USER_QUERY_SUBJECT.BILLING,
        message: "I need a copy of my past 6 months invoices.",
        userRef,
        companyRef,
        status: USER_QUERY_STATUS.PENDING,
        createdAt: randomDateWithinLastTwoMonths(),
        updatedAt: new Date(),
      },
      {
        name: { first: "Kevin", last: "Harris" },
        email: "kevin.harris@example.com",
        subject: USER_QUERY_SUBJECT.TECHNICAL,
        message: "Two-factor authentication is not working for me.",
        userRef,
        companyRef,
        status: USER_QUERY_STATUS.IN_PROGRESS,
        createdAt: randomDateWithinLastTwoMonths(),
        updatedAt: new Date(),
      },
      {
        name: { first: "Laura", last: "Robinson" },
        email: "laura.robinson@example.com",
        subject: USER_QUERY_SUBJECT.FEATURE,
        message: "Please add more payment options like PayPal.",
        userRef,
        companyRef,
        status: USER_QUERY_STATUS.RESOLVED,
        createdAt: randomDateWithinLastTwoMonths(),
        updatedAt: new Date(),
      },
      {
        name: { first: "Mike", last: "Garcia" },
        email: "mike.garcia@example.com",
        subject: USER_QUERY_SUBJECT.GENERAL,
        message: "Where can I find your privacy policy?",
        userRef,
        companyRef,
        status: USER_QUERY_STATUS.PENDING,
        createdAt: randomDateWithinLastTwoMonths(),
        updatedAt: new Date(),
      },
      {
        name: { first: "Nina", last: "Young" },
        email: "nina.young@example.com",
        subject: USER_QUERY_SUBJECT.TECHNICAL,
        message: "My uploaded files keep disappearing from storage.",
        userRef,
        companyRef,
        status: USER_QUERY_STATUS.IN_PROGRESS,
        createdAt: randomDateWithinLastTwoMonths(),
        updatedAt: new Date(),
      },
      {
        name: { first: "Oscar", last: "Allen" },
        email: "oscar.allen@example.com",
        subject: USER_QUERY_SUBJECT.BILLING,
        message: "Why was my subscription canceled automatically?",
        userRef,
        companyRef,
        status: USER_QUERY_STATUS.PENDING,
        createdAt: randomDateWithinLastTwoMonths(),
        updatedAt: new Date(),
      },
      {
        name: { first: "Paula", last: "Scott" },
        email: "paula.scott@example.com",
        subject: USER_QUERY_SUBJECT.FEATURE,
        message: "Consider adding voice command features.",
        userRef,
        companyRef,
        status: USER_QUERY_STATUS.RESOLVED,
        createdAt: randomDateWithinLastTwoMonths(),
        updatedAt: new Date(),
      },
      {
        name: { first: "Quentin", last: "Adams" },
        email: "quentin.adams@example.com",
        subject: USER_QUERY_SUBJECT.TECHNICAL,
        message: "I'm unable to connect through the mobile app.",
        userRef,
        companyRef,
        status: USER_QUERY_STATUS.PENDING,
        createdAt: randomDateWithinLastTwoMonths(),
        updatedAt: new Date(),
      },
      {
        name: { first: "Rachel", last: "Baker" },
        email: "rachel.baker@example.com",
        subject: USER_QUERY_SUBJECT.GENERAL,
        message: "How do I update my contact information?",
        userRef,
        companyRef,
        status: USER_QUERY_STATUS.IN_PROGRESS,
        createdAt: randomDateWithinLastTwoMonths(),
        updatedAt: new Date(),
      },
      {
        name: { first: "Sam", last: "Turner" },
        email: "sam.turner@example.com",
        subject: USER_QUERY_SUBJECT.BILLING,
        message: "Do you provide GST invoices?",
        userRef,
        companyRef,
        status: USER_QUERY_STATUS.PENDING,
        createdAt: randomDateWithinLastTwoMonths(),
        updatedAt: new Date(),
      },
      {
        name: { first: "Tina", last: "Phillips" },
        email: "tina.phillips@example.com",
        subject: USER_QUERY_SUBJECT.FEATURE,
        message: "UI looks modern but could use more accessibility features.",
        userRef,
        companyRef,
        status: USER_QUERY_STATUS.RESOLVED,
        createdAt: randomDateWithinLastTwoMonths(),
        updatedAt: new Date(),
      },
    ];

    await UserQuery.insertMany(queries);
    console.log("✅ Seeded 20 UserQuery documents with random createdAt dates");

    await mongoose.disconnect();
    console.log("🔌 Disconnected from MongoDB");
  } catch (err) {
    console.error("❌ Error seeding data:", err);
    process.exit(1);
  }
}

seed();
