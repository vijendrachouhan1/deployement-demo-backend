import { Products } from "@/db/models/products";
import envConfig from "@/config/env";
import { faker } from "@faker-js/faker";
import { Types } from "mongoose";

export type seedProductsType = {
  userRef: string;
  companyRef: string;
};

// This will create multiple products under the name of single admin.
export async function seedProducts(props: seedProductsType) {
  try {
    const numProducts = envConfig.NUM_TEST_DATA;

    const products = [];
    for (let i = 0; i < numProducts; i++) {
      products.push({
        title: faker.commerce.productName(),
        productImages: [faker.image.url(), faker.image.url()],
        description: faker.commerce.productDescription(),
        price: faker.commerce.price(),
        costPrice: faker.commerce.price(),
        retailPrice: faker.commerce.price(),
        salePrice: faker.commerce.price(),
        userRef: props.userRef ?? new Types.ObjectId(),
        companyRef: props.companyRef ?? new Types.ObjectId(),
      });
    }

    await Products.insertMany(products);
    console.log(`${numProducts} products seeded successfully.`);
  } catch (error) {
    console.error(`Error seeding products`, error);
  }
}
