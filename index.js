'use strict'

const fromVals = require('gl-vec3/fromValues')
const create = require('gl-vec3/create')
const normalize = require('gl-vec3/normalize')
const add = require('gl-vec3/add')
const length = require('gl-vec3/length')
const scaleAndAdd = require('gl-vec3/scaleAndAdd')
const raySphereInt = require('ray-sphere-intersection')

const RYLH_SCATTERING = fromVals(5.5e-6, 13e-6, 22.4e-6) // Rayleigh scat. coefficient
const RYLH_SCALE_HEIGHT = 8e3 // Rayleigh scattering scale height
const MIE_SCATTERING = [21e-6] // Mie scattering coefficient
const MIE_SCALE_HEIGHT = 1.2e3 // Mie scattering scale height
const MIE_PREFERRED_DIRECTION = .758
const PRIMARY_STEPS = 16
const SECONDARY_STEPS = 8

const ORIGIN = [0, 0, 0]

const defaults = {
  rayOrigin: fromVals([0, 6372e3, 0]),
  sunIntensity: 22,
  planetRadius: 6371e3, // in meters
  atmosphereRadius: 6471e3 // in meters
}

const createScattering = (sunP, opt = {}) => { // sun position, options
  sunP = normalize(create(), sunP)

  opt = Object.assign({}, defaults, opt)
  const rayO = opt.rayOrigin
  const sunI = opt.sunIntensity
  const planetR = opt.planetRadius
  const atmosR = opt.atmosphereRadius

  let tmp1 = new Array(3).fill(0)
  let tmp2 = new Array(3).fill(0)
  let tmpv1 = create()
  let tmpv2 = create()

  const scattering = (rayD) => { // view/ray direction
    rayD = normalize(create(), rayD) // todo: prevent GC

    // todo: prevent GC
    let totalRylh = create() // Rayleigh scattering accumulator
    let totalMie = create() // Mie scattering accumulator

    // calculate step size of primary ray
    raySphereInt(tmp1, rayO, rayD, ORIGIN, atmosR)
    if (!tmp1 || tmp1[0] > tmp1[1]) { // ray misses atmosphere, no light
      return [0, 0, 0] // todo: prevent GC
    }
    raySphereInt(tmp2, rayO, rayD, ORIGIN, planetR)
    tmp1[1] = Math.min(tmp1[1], tmp2[0])
    const pStep = (tmp1[1] - tmp1[0]) / PRIMARY_STEPS

    let pTime = 0 // primary ray time
    let pOptDepRylh = 0 // primary ray optical depth accumulator (Rayleigh scattering)
    let pOptDepMie = 0 // primary ray optical depth accumulator (Mie scattering)

    // sample the primary ray
    for (let i = 0; i < PRIMARY_STEPS; i++) {
      // calculate the current position of the primary ray
      // todo: prevent GC
      const currPos = scale(create(), rayD, pTime + pStep * .5)
      add(currPos, rayO, currPos)

      // calculate the current height of the primary ray
      const currHeight = length(currPos) - planetR

      // calculate optical depth of Rayleigh & Mie scattering for this step
      const currOptDepRylh = Math.exp(-currHeight / RYLH_SCALE_HEIGHT) * pStep
      const currOptDepMie = Math.exp(-currHeight / MIE_SCALE_HEIGHT) * pStep

      // accumulate optical depth
      pOptDepRylh += currOptDepRylh
      pOptDepMie += currOptDepMie

      // calculate step size of secondary ray
      raySphereInt(tmp1, currPos, sunP, ORIGIN, atmosR)
      const sStep = tmp1[1] / SECONDARY_STEPS

      let sTime = 0 // secondary ray time
      let sOptDepRylh = 0 // secondary ray optical depth accumulator (Rayleigh scattering)
      let sOptDepMie = 0 // secondary ray optical depth accumulator (Mie scattering)

      // sample the secondary ray
      for (let j = 0; j < SECONDARY_STEPS; j++) {
        // calculate the current position of the secondary ray
        const currPos = scale(create(), rayD, sTime + pStep * .5)
        add(currPos, rayO, currPos)

        // calculate the current height of the secondary ray
        const currHeight = length(currPos) - planetR

        // calculate & accumulate optical depth of Rayleigh & Mie scattering
        sOptDepRylh += Math.exp(-currHeight / RYLH_SCALE_HEIGHT) * sStep
        sOptDepMie += Math.exp(-currHeight / MIE_SCALE_HEIGHT) * sStep

        // increment secondary ray time
        sTime += sStep
      }

      // calculate attenuation
      // exp(-(
      //   MIE_SCATTERING * (pOptDepMie + sOptDepMie) +
      //   RYLH_SCATTERING * (pOptDepRylh + sOptDepRylh)
      // ))
      const m = MIE_SCATTERING * (pOptDepMie + sOptDepMie)
      set(tmpv1, m, m, m)
      scale(tmpv2, RYLH_SCATTERING, pOptDepRylh + sOptDepRylh)
      add(tmpv1, tmpv1, tmpv2)
      negate(tmpv1, tmpv1) // todo: this can be optimised
      // todo: exp, assign to `attenuation`

      // accumulate scattering
      // totalRylh += currOptDepRylh * attenuation
      scaleAndAdd(totalRylh, totalRylh, attenuation, currOptDepRylh)
      // totalMie += currOptDepMie * attenuation
      scaleAndAdd(totalMie, totalMie, attenuation, currOptDepMie)

      // increment primary ray time
      pTime += pStep
    }

    // calculate the Rayleigh and Mie phases
    const mu = dot(rayD, sunP)
    const mu2 = mu * mu
    const g2 = MIE_PREFERRED_DIRECTION * MIE_PREFERRED_DIRECTION
    // todo: proper names
    const phaseRylh = 3 / (16 * Math.PI) * (1 + mu2)
    const phaseMie = (
      3 / (8 * Math.PI) * (1 - g2) * (1 + mu2) /
      Math.pow(1 + g2 - 2 * mu * MIE_PREFERRED_DIRECTION, 1.5) * (2 + g2)
    )

    // calculate final color, store in tmpv1
    // sunI * (
    //   phaseRylh * RYLH_SCATTERING * totalRylh +
    //   phaseMie * MIE_SCATTERING * totalMie
    // )
    scale(tmpv1, totalRylh, phaseRylh)
    multiply(tmpv1, tmpv1, RYLH_SCATTERING)
    scale(tmpv2, totalMie, phaseMie)
    scale(tmpv2, tmpv2, MIE_SCATTERING)
    add(tmpv1, tmpv1, tmpv2)
    scale(tmpv1, sunI)

    return tmpv1

    // apply exposure
    // return 1 - Math.exp(-color) // todo: why? what is this?
  }

  return scattering
}

module.exports = createScattering
