import { log, BigInt, BigDecimal, Address, Hash } from '@graphprotocol/graph-ts'

import { Fund, User, UserInFund } from '../generated/schema'

import { ERC20 } from '../generated/mai-fund-graph/ERC20'
import { ERC20SymbolBytes } from '../generated/mai-fund-graph/ERC20SymbolBytes'
import { ERC20NameBytes } from '../generated/mai-fund-graph/ERC20NameBytes'
import { Fund as FundContract } from '../generated/mai-fund-graph/Fund'
import { Perpetual } from '../generated/mai-fund-graph/Perpetual'



export const ADDRESS_ZERO = '0x0000000000000000000000000000000000000000'
export let ZERO_BI = BigInt.fromI32(0)
export let ONE_BI = BigInt.fromI32(1)
export let ZERO_BD = BigDecimal.fromString('0')
export let ONE_BD = BigDecimal.fromString('1')
export let BI_18 = BigInt.fromI32(18)

export let FUND_LIST = ["0xA8cD84eE8aD8eC1c7ee19E578F2825cDe18e56d1"]
const FUND_RSI = {
  "0xA8cD84eE8aD8eC1c7ee19E578F2825cDe18e56d1": "0x793f396873Ae7394311b0fAb7644aE182CF9093B"
}

// added ["USDT", "USDC", "DAI"]
const USDTokens = {
  "0xdac17f958d2ee523a2206206994597c13d831ec7": true,
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": true,
  "0x6b175474e89094c44da98b954eedeac495271d0f": true
}

export function isUSDCollateral(collateral: string): boolean {
    if (USDTokens[collateral]){
      return true
    }
    return false
}

export function getRSITrendingStrategy(address: Address): string {
  if (FUND_RSI[address.toHexString()]) {
    return FUND_RSI[address.toHexString()]
  }
  return ""
}

export function fetchFund(address: Address): Fund {
    let fund = Fund.load(address.toHexString())
    if (fund === null) {
      fund = new Fund(address.toHexString())
      fund.symbol = fetchTokenSymbol(address)
      fund.name = fetchTokenName(address)
      fund.perpetual = fetchPerpetualAddress(address)
      fund.collateral = fetchCollateral(address)
      fund.RSITrendingStrategy = getRSITrendingStrategy(address)
    
      // contract state: Normal, Emergency, Shutdown
      fund.state = 0
    
      // contract param
      fund.redeemingLockPeriod = ZERO_BI
      fund.entranceFeeRate = ZERO_BI
      fund.streamingFeeRate = ZERO_BI
      fund.performanceFeeRate = ZERO_BI
      fund.globalRedeemingSlippage = ZERO_BI
      fund.cap = ZERO_BI
      fund.drawdownHighWaterMark = ZERO_BI
      fund.leverageHighWaterMark = ZERO_BI
    
      // AutoTrading fund
      fund.rebalanceSlippage = ZERO_BI
      fund.rebalanceTolerance = ZERO_BI
    
      // SocialTrading fund
      fund.manager = ""

      fund.totalSupply = ZERO_BI
      fund.initNetAssetValuePerShare = ZERO_BD

      fund.userInFunds = []
      fund.purchases = []
      fund.redeems = []
      fund.save()
    }
    return fund as Fund
}

export function fetchUser(address: Address): User {
  let user = User.load(address.toHexString())
  if (user === null) {
    user = new User(address.toHexString())
    user.userInFunds = []
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
    userInFund.id = fund.id
    userInFund.shareAmount = ZERO_BI
    userInFund.redeemingShareAmount = ZERO_BI
    userInFund.assetValue = ZERO_BD
    userInFund.purchases = []
    userInFund.redeems = []

    let newUserInFunds = user.userInFunds
    newUserInFunds.push(userInFund.id)
    user.userInFunds = newUserInFunds

    newUserInFunds = fund.userInFunds
    newUserInFunds.push(userInFund.id)
    fund.userInFunds = newUserInFunds

    userInFund.save()
    user.save()
    fund.save()
  }
  return userInFund as UserInFund
}

export function isNullEthValue(value: string): boolean {
  return value == '0x0000000000000000000000000000000000000000000000000000000000000001'
}

export function fetchTokenName(tokenAddress: Address): string {
  let contract = ERC20.bind(tokenAddress)
  let contractNameBytes = ERC20NameBytes.bind(tokenAddress)

  // try types string and bytes32 for name
  let nameValue = 'unknown'
  let nameResult = contract.try_name()
  if (nameResult.reverted) {
    let nameResultBytes = contractNameBytes.try_name()
    if (!nameResultBytes.reverted) {
      // for broken exchanges that have no name function exposed
      if (!isNullEthValue(nameResultBytes.value.toHexString())) {
        nameValue = nameResultBytes.value.toString()
      }
    }
  } else {
    nameValue = nameResult.value
  }

  return nameValue
}

export function fetchTokenSymbol(tokenAddress: Address): string {
  let contract = ERC20.bind(tokenAddress)
  let contractSymbolBytes = ERC20SymbolBytes.bind(tokenAddress)

  // try types string and bytes32 for symbol
  let symbolValue = 'unknown'
  let symbolResult = contract.try_symbol()
  if (symbolResult.reverted) {
    let symbolResultBytes = contractSymbolBytes.try_symbol()
    if (!symbolResultBytes.reverted) {
      // for broken pairs that have no symbol function exposed
      if (!isNullEthValue(symbolResultBytes.value.toHexString())) {
        symbolValue = symbolResultBytes.value.toString()
      }
    }
  } else {
    symbolValue = symbolResult.value
  }

  return symbolValue
}

export function fetchPerpetualAddress(address: Address): Address {
  let contract = FundContract.bind(address)
  let perpetual = ''
  let result = contract.try_perpetual()
  if (!result.reverted) {
    perpetual = result.value.toString() 
  }
  return perpetual
}

export function fetchCollateral(address: Address): Address {
  let contract = FundContract.bind(address)
  let collateral = ''
  let result = contract.try_collateral()
  if (!result.reverted) {
    collateral = result.value.toString() 
  }
  return collateral
}