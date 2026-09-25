import { Router, type IRouter } from "express";
import accessRouter from "./access";
import healthRouter from "./health";

const router: IRouter = Router();

router.use(healthRouter);
router.use(accessRouter);

export default router;
