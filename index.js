'use strict'

const fromVals = require('gl-vec3/fromValues')
const create = require('gl-vec3/create')
const normalize = require('gl-vec3/normalize')
const add = require('gl-vec3/add')
const length = require('gl-vec3/length')
const raySphereInt = require('ray-sphere-intersection')

// const RYLH_SCATTERING = fromVals(5.5e-6, 13e-6, 22.4e-6) // Rayleigh scat. coefficient
const RYLH_SCALE_HEIGHT = 8e3 // Rayleigh scattering scale height
// const MIE_SCATTERING = [21e-6] // Mie scattering coefficient
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

  const scattering = (rayD) => { // view/ray direction
    rayD = normalize(create(), rayD) // todo: prevent GC

    // calculate the Rayleigh and Mie phases
    const mu = dot(rayD, sunP)
    const mu2 = mu * mu
    const g2 = MIE_PREFERRED_DIRECTION * MIE_PREFERRED_DIRECTION
    // todo: proper names
    const _Rylh = 3 / (16 * Math.PI) * (1 + mu2)
    const _Mie = (
      3 / (8 * Math.PI) * (1 - g2) * (1 + mu2) /
      Math.pow(1 + g2 - 2 * mu * MIE_PREFERRED_DIRECTION, 1.5) * (2 + g2)
    )

    let totalRylh = create(0) // Rayleigh scattering accumulator
    let totalMie = create(0) // Mie scattering accumulator

    // calculate step size of primary ray
    let hit = raySphereInt([], rayO, rayD, ORIGIN, atmosR)
    if (!hit || hit[0] > hit[1]) { // ray misses atmosphere, no light
      return [0, 0, 0] // todo: prevent GC
    }
    hit[1] = Math.min(hit[1], raySphereInt([], rayO, rayD, ORIGIN, planetR)[1])
    const pStep = (hit[1] - hit[0]) / PRIMARY_STEPS

    let pTime = 0 // primary ray time
    let pOptDepRylh = 0 // primary ray optical depth accumulator (Rayleigh scattering)
    let pOptDepMie = 0 // primary ray optical depth accumulator (Mie scattering)

    // sample the primary ray
    for (let i = 0; i < PRIMARY_STEPS; i++) {
      // calculate the current position of the primary ray
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
      raySphereInt(hit, currPos, sunP, ORIGIN, atmosR)
      const sStep = hit[1] / SECONDARY_STEPS

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
    }

    // todo

    // apply exposure
    // return 1 - Math.exp(-color) // todo: why? what is this?
  }

  return scattering
}

module.exports = createScattering
