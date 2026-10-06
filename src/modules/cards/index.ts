import { Router } from "express";
import { Middleware } from "@/middleware/auth";
import { CardController } from "@/modules/cards/card.controller";
import { cardValidators } from "@/modules/cards/utils/card.validation";

const middleware = new Middleware();

export class CardRouter {
  router: Router;

  constructor() {
    this.router = Router();
    this.router.use(middleware.authMiddleware);

    this.initializeRoutes();
  }

  private initializeRoutes() {
    const controller = new CardController();

    this.router
      .get("/", cardValidators.listCards, controller.listCards)
      .post("/add", cardValidators.addCard, controller.addCard)
      .post(
        "/default",
        cardValidators.setDefaultCard,
        controller.setDefaultCard,
      );
  }
}
