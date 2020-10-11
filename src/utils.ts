import { log, BigInt, BigDecimal, Address } from '@graphprotocol/graph-ts'

import { Fund, User, UserInFund } from '../generated/schema'

import { Fund as FundContract } from '../generated/templates/commonFund/Fund'
import { commonFund as FundTemplate } from '../generated/templates'


export const ADDRESS_ZERO = '0x0000000000000000000000000000000000000000'
export let ZERO_BI = BigInt.fromI32(0)
export let ONE_BI = BigInt.fromI32(1)
export let ZERO_BD = BigDecimal.fromString('0')
export let ONE_BD = BigDecimal.fromString('1')
export let BI_18 = BigInt.fromI32(18)

// Notice: lowercase
export let FUND_LIST:string[] = ["0x38884e823e6f1cd93757ed74b06380b22761a3de"]
export let FUND_RSI_LIST:string[] = ["0xe61dc1a443ac7f8f1aa56afa1197d6e822d254ad"]

// added ["USDT", "USDC", "DAI"]
export let USDTokens:string[] = [
  "0xdac17f958d2ee523a2206206994597c13d831ec7",
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  "0x6b175474e89094c44da98b954eedeac495271d0f"
]

export function isUSDCollateral(collateral: string): boolean {
  for (let i = 0; i < USDTokens.length; i++) {
    if (collateral == USDTokens[i]) {
      return true
    }
  }
  return false
}

export function getRSITrendingStrategy(address: Address): string {
  for (let i = 0; i < FUND_LIST.length; i++) {
    if (address.toHexString() == FUND_LIST[i]) {
      return FUND_RSI_LIST[i]
    }
  }
  return ""
}

export function fetchFund(address: Address): Fund {
    let fund = Fund.load(address.toHexString())
    if (fund === null) {
      // create the tracked contract based on the template
      FundTemplate.create(address)

      fund = new Fund(address.toHexString())
      fund.symbol = fetchTokenSymbol(address)
      fund.name = fetchTokenName(address)
      fund.perpetual = fetchPerpetualAddress(address)
      fund.collateral = fetchCollateral(address)
      fund.RSITrendingStrategy = getRSITrendingStrategy(address)
    
      // contract state: Normal, Emergency, Shutdown
      fund.state = 0
    
      // contract param
      fund.redeemingLockPeriod = ZERO_BD
      fund.entranceFeeRate = ZERO_BD
      fund.streamingFeeRate = ZERO_BD
      fund.performanceFeeRate = ZERO_BD
      fund.globalRedeemingSlippage = ZERO_BD
      fund.cap = ZERO_BD
      fund.drawdownHighWaterMark = ZERO_BD
      fund.leverageHighWaterMark = ZERO_BD
    
      // AutoTrading fund
      fund.rebalanceSlippage = ZERO_BD
      fund.rebalanceTolerance = ZERO_BD
    
      // SocialTrading fund
      fund.manager = ""

      fund.totalSupply = ZERO_BD
      fund.initNetAssetValuePerShare = ZERO_BD
      fund.initTimestamp = 0

      fund.save()
    }
    return fund as Fund
}

export function fetchUser(address: Address): User {
  let user = User.load(address.toHexString())
  if (user === null) {
    user = new User(address.toHexString())
    user.save()
  }
  return user as User
}

export function fetchUserInFund(userAddress: Address, fundAddress: Address): UserInFund {
  let id = userAddress
    .toHexString()
    .concat('-')
    .concat(fundAddress.toHexString())
  let userInFund = UserInFund.load(id)
  if (userInFund === null) {
    let user = fetchUser(userAddress)
    let fund = fetchFund(fundAddress)

    userInFund = new UserInFund(id)
    userInFund.user = user.id
    userInFund.fund = fund.id
    userInFund.shareAmount = ZERO_BD
    userInFund.redeemingShareAmount = ZERO_BD
    userInFund.totalPurchaseCollateral = ZERO_BD
    userInFund.totalRedeemedCollateral = ZERO_BD
    userInFund.totalPurchaseShare = ZERO_BD
    userInFund.totalRedeemedShare = ZERO_BD
    userInFund.costCollateral = ZERO_BD
    userInFund.lastPurchaseTime = 0

    userInFund.save()
  }
  return userInFund as UserInFund
}

export function isNullEthValue(value: string): boolean {
  return value == '0x0000000000000000000000000000000000000000000000000000000000000001'
}

export function exponentToBigDecimal(decimals: BigInt): BigDecimal {
  let bd = BigDecimal.fromString('1')
  for (let i = ZERO_BI; i.lt(decimals as BigInt); i = i.plus(ONE_BI)) {
    bd = bd.times(BigDecimal.fromString('10'))
  }
  return bd
}

export function convertToDecimal(amount: BigInt, decimals: BigInt): BigDecimal {
  if (decimals == ZERO_BI) {
    return amount.toBigDecimal()
  }
  return amount.toBigDecimal().div(exponentToBigDecimal(decimals))
}

export function fetchTokenName(tokenAddress: Address): string {
  let contract = FundContract.bind(tokenAddress)
  let nameValue = 'unknown'
  let nameResult = contract.try_name()
  if (!nameResult.reverted) {
    nameValue = nameResult.value
  }

  return nameValue
}

export function fetchTokenSymbol(tokenAddress: Address): string {
  let contract = FundContract.bind(tokenAddress)
  let symbolValue = 'unknown'
  let symbolResult = contract.try_symbol()
  if (!symbolResult.reverted) {
    symbolValue = symbolResult.value
  }

  return symbolValue
}

export function fetchPerpetualAddress(address: Address): string {
  let contract = FundContract.bind(address)
  let perpetual = ''
  let result = contract.try_perpetual()
  if (!result.reverted) {
    perpetual = result.value.toHexString()
  }
  return perpetual
}

export function fetchCollateral(address: Address): string {
  let contract = FundContract.bind(address)
  let collateral = ''
  let result = contract.try_collateral()
  if (!result.reverted) {
    collateral = result.value.toHexString()
  }
  return collateral
}