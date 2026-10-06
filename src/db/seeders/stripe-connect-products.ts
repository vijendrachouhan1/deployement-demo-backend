import mongoose from "mongoose";
import { faker } from "@faker-js/faker";
import { StripeConnectProducts } from "@/db/models/stripeConnect/products";

// Please change the companyRef and userRef accordingly
const companyRef = new mongoose.Types.ObjectId("68ca951ae2c24f892b6319f9");
const userRef = new mongoose.Types.ObjectId("68ca951ae2c24f892b6319fb");
const stripeAccountId = "acct_1S8JEvI64X928ftI";

const MONGO_URI = "mongodb://localhost:27017/boilerplate";

async function seedProducts(count = 10) {
  try {
    await mongoose.connect(MONGO_URI);

    const products = Array.from({ length: count }).map(() => ({
      title: faker.commerce.productName(),
      price: Number(faker.commerce.price({ min: 10, max: 1500 })),
      userRef,
      companyRef,
      stripeAccountId,
      createdAt: faker.date.recent({ days: 60 }),
      updatedAt: new Date(),
    }));

    await StripeConnectProducts.insertMany(products);

    console.log(`✅ Inserted ${count} products`);
    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error("❌ Error seeding products:", err);
    process.exit(1);
  }
}

seedProducts(46); // pass how many products you want
