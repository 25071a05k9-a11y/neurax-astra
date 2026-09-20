import { Vector3 } from "three";
import { robotPose, smooth } from "./robotMotion.ts";
export const PART_SECONDS = 20;
export const BELT_PART_Y = 0.687;
export type WorkflowRoute = {
  stock: Vector3;
  lift: Vector3;
  sourcePort: Vector3;
  infeed: Vector3;
  transferPath?: Vector3[];
  robotOrigin: Vector3;
  outfeed: Vector3;
  inspection: Vector3;
  inspectionPath?: Vector3[];
  output: Vector3;
  hasRobot: boolean;
};
export function along(points: Vector3[], fraction: number) {
  const lengths = points.slice(1).map((p, i) => p.distanceTo(points[i]));
  const total = lengths.reduce((a, b) => a + b, 0);
  let distance = Math.max(0, Math.min(1, fraction)) * total;
  for (let i = 0; i < lengths.length; i++) {
    if (distance <= lengths[i] || i === lengths.length - 1)
      return points[i]
        .clone()
        .lerp(points[i + 1], lengths[i] > 0 ? distance / lengths[i] : 0);
    distance -= lengths[i];
  }
  return points[0].clone();
}
export function productionPose(t: number, r: WorkflowRoute) {
  if (!r) {
    const hand = robotPose(0);
    return {
      position: new Vector3(),
      state: "Route unavailable",
      hand,
      held: false,
      done: true,
    };
  }
  const time = Math.max(0, Math.min(PART_SECONDS, t));
  if (time >= PART_SECONDS) {
    return {
      position: r.output.clone(),
      state: "Delivered",
      hand: robotPose(8.99999),
      held: false,
      done: true,
    };
  }
  const liftHigh = r.lift.clone().setY(r.stock.y);
  const pickup = r.robotOrigin.clone().add(new Vector3(-0.28, 0.687, 0.7));
  const hand = robotPose(Math.min(8.99999, Math.max(0, time - 5)));
  let position: Vector3;
  let state: string;
  if (time < 1) {
    position = r.stock.clone().lerp(liftHigh, smooth(time));
    state = "Retrieve from shelf";
  } else if (time < 2) {
    position = liftHigh.clone().lerp(r.lift, smooth(time - 1));
    state = "Lower to infeed";
  } else if (time < 5) {
    position = along(
      [
        r.lift,
        ...(r.transferPath?.length ? r.transferPath : [r.sourcePort, r.infeed]),
        pickup,
      ],
      smooth((time - 2) / 3),
    );
    state = "Infeed transfer";
  } else if (time < 14 && r.hasRobot) {
    position = hand.part.clone().add(r.robotOrigin);
    state = hand.state;
  } else if (time < 14) {
    position = along([pickup, r.outfeed], smooth((time - 5) / 9));
    state = "Processing transfer";
  } else if (time < 17) {
    const released = r.hasRobot
      ? robotPose(8.99999).part.clone().add(r.robotOrigin)
      : r.outfeed;
    position = along(
      [
        released,
        r.outfeed,
        ...(r.inspectionPath?.length
          ? r.inspectionPath.slice(1)
          : [r.inspection]),
      ],
      smooth((time - 14) / 3),
    );
    state = "Move to inspection";
  } else if (time < 18) {
    position = r.inspection.clone();
    state = "Verify part";
  } else {
    position = along(
      [r.inspection, r.output.clone().setY(BELT_PART_Y), r.output],
      smooth((time - 18) / 2),
    );
    state = time === 20 ? "Delivered" : "Outfeed to tray";
  }
  return {
    position,
    state,
    hand,
    held: r.hasRobot && time >= 5 && time < 14 && hand.closed,
    done: time >= PART_SECONDS,
  };
}
