/* * * * *
 * ..................
 *  LINKAGE
 * ..................
 *
 *   p0 *----* p1
 *            \       * p0 = origin / bodyContactPoint
 *             * p2   * p1 = coxiaPoint
 *             |      * p2 = femurPoint
 *             * p3   * p3 = tibiaPoint / footTipPoint
 *                    * coxiaVector = vector from p0 to p1
 *   localZ           * femurVector = vector from p1 to p2
 *   |  localY        * tibiaVector = vector from p2 to p3
 *   | /
 *   |/
 *   |------ localX   * LegPointId = {legId}-{pointId}
 *
 *
 *           2           1       * legId - legName     - localXaxisAngle
 *            \   head  /        *  0    - rightMiddle - 0
 *             *---*---*         *  1    - rightFront  - 45
 *            /    |    \        *  2    - leftFront   - 135
 *           /     |     \       *  3    - leftMiddle  - 180
 *       3 -*-----cog-----*- 0   *  4    - leftBack    - 225
 *           \     |     /       *  5    - rightBack   - 315
 *            \    |    /
 *             *---*---*          ^ hexapodY
 *            /         \         |
 *           4           5        *---> hexapodX
 *                               /
 *                              * hexapodZ
 *
 *                   * localXaxisAngle = angle made by hexapodXaxis and localXaxis
 *                   * alpha = angle made by coxia Vector and localXaxis
 *           p2      * beta = angle made by coxiaVector and femurVector
 *           *              = angle made by points p2, p1 and pxPrime
 *          / \
 *     *---*---\---> pxPrime
 *    p0   p1   * p3
 *
 *
 *    p0   p1         * gamma = angle made by vector perpendicular to
 *     *---*                    coxiaVector and tibiaVector
 *         | \                = angle made by points pzPrime, p1, p3
 *         |  \
 *         V   * p3
 *        pzPrime
 *
 *
 * * * * */
import { multiply } from "mathjs"
import { tRotYframe, tRotZframe, pointWrtFrame } from "./utilities/geometry"
import {
    LEG_POINT_TYPES,
    POSITION_ID_MAP,
    LOCAL_X_AXIS_ANGLE_MAP,
} from "./constants"

class Linkage {
    constructor(
        dimensions = { coxia: 100, femur: 100, tibia: 100 },
        position = "linkage-position-not-defined",
        bodyContactPoint = { x: 0, y: 0, z: 0 },
        pose = { alpha: 0, beta: 0, gamma: 0 }
    ) {
        this.dimensions = dimensions
        this.pose = pose
        this.position = position
        this.name = `${position}Leg`

        this.id = POSITION_ID_MAP[this.position]
        this.pointNameIdMap = this._buildPointNameIdMap()
        this.givenBodyContactPoint = {
            ...bodyContactPoint,
            name: this.pointNameIdMap.bodyContact.name,
            id: this.pointNameIdMap.bodyContact.id,
        }
        this.pointsMap = this._computePoints(pose)
        this.allPointsList = LEG_POINT_TYPES.reduce(
            (acc, pointType) => [...acc, this.pointsMap[pointType]],
            []
        )

        this.maybeFootTipsOnGround = this._computeMaybeFootTipOnGround()
    }

    /* *
     * .............
     * structure of pointNameIdMap
     * .............
     *
     * pointNameIdMap = {
     *   bodyContact: {name: "{legPosition}-bodyContactPoint", id: "{legId}-0" },
     *   coxia: {name: "{legPosition}-coxiaPoint", id: "{legId}-1" },
     *   femur: {name: "{legPosition}-femurPoint", id: "{legId}-2" },
     *   footTip: {name: "{legPosition}-footTipPoint", id: "{legId}-3" },
     * }
     *
     * */
    _buildNameId = (pointName, id) => ({
        name: `${this.position}-${pointName}Point`,
        id: `${this.id}-${id}`,
    })

    _buildPointNameIdMap = () =>
        LEG_POINT_TYPES.reduce((acc, pointType, index) => {
            acc[pointType] = this._buildNameId(pointType, index)
            return acc
        }, {})

    /* *
     * ................
     * STEP 1 of computing points:
     *   find points wrt body contact point
     * ................
     * NOTE:
     * frame_ab is the pose of frame_b wrt frame_a
     * where pa is the origin of frame_a
     * and pb is the origin of frame_b wrt pa
     *
     * */
    _computePointsWrtBodyContact(beta, gamma) {
        const frame01 = tRotYframe(-beta, this.dimensions.coxia, 0, 0)
        const frame12 = tRotYframe(90 - gamma, this.dimensions.femur, 0, 0)
        const frame23 = tRotYframe(0, this.dimensions.tibia, 0, 0)
        const frame02 = multiply(frame01, frame12)
        const frame03 = multiply(frame02, frame23)

        const localBodyContactPoint = {
            x: 0,
            y: 0,
            z: 0,
            name: this.pointNameIdMap.bodyContact.name,
            id: this.pointNameIdMap.bodyContact.id,
        }

        const localPointsMap = {
            bodyContact: localBodyContactPoint,
            coxia: pointWrtFrame(localBodyContactPoint, frame01),
            femur: pointWrtFrame(localBodyContactPoint, frame02),
            footTip: pointWrtFrame(localBodyContactPoint, frame03),
        }

        return localPointsMap
    }

    /* *
     * ................
     * STEP 2 of computing points:
     *   find local points wrt hexapod's center of gravity (0, 0, 0)
     * ................
     */
    _computePointsWrtHexapodsCog(localPointsMap, alpha) {
        const twistFrame = tRotZframe(
            LOCAL_X_AXIS_ANGLE_MAP[this.position] + alpha,
            this.givenBodyContactPoint.x,
            this.givenBodyContactPoint.y,
            this.givenBodyContactPoint.z
        )

        const pointsMap = LEG_POINT_TYPES.reduce((acc, pointType) => {
            const point = pointWrtFrame(
                localPointsMap[pointType],
                twistFrame,
                this.pointNameIdMap[pointType].name,
                this.pointNameIdMap[pointType].id
            )
            acc[pointType] = point
            return acc
        }, {})

        return pointsMap
    }

    _computePoints(pose) {
        const { alpha, beta, gamma } = pose
        const localPointsMap = this._computePointsWrtBodyContact(beta, gamma)
        const pointsMap = this._computePointsWrtHexapodsCog(localPointsMap, alpha)
        return pointsMap
    }

    _computeMaybeFootTipOnGround() {
        const reversedPointList = this.allPointsList.slice().reverse()
        const testPoint = reversedPointList[0]
        const footTip = reversedPointList.reduce(
            (testPoint, point) => (point.z < testPoint.z ? point : testPoint),
            testPoint
        )
        return footTip
    }
}

export default Linkage
