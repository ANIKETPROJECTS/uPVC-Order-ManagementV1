import { Router, type IRouter } from "express";
import accessRouter from "./access";
import chatRouter from "./chat";
import healthRouter from "./health";

const router: IRouter = Router();

router.use(healthRouter);
router.use(accessRouter);
router.use(chatRouter);

export default router;
