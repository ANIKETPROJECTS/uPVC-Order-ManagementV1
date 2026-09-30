import { Router, type IRouter } from "express";
import accessRouter from "./access";
import chatRouter from "./chat";
import healthRouter from "./health";
import orderHubRouter from "./order-hub";
import orderWorkspaceRouter from "./order-workspace";

const router: IRouter = Router();

router.use(healthRouter);
router.use(accessRouter);
router.use(chatRouter);
router.use(orderHubRouter);
router.use(orderWorkspaceRouter);

export default router;
