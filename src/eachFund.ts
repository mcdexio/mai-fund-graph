import { BigInt, ethereum, log, Address } from "@graphprotocol/graph-ts"

import {
    Fund as FundContract
} from '../generated/templates/commonFund/Fund';

import {
    Perpetual,
} from '../generated/mai-fund-graph/Perpetual';

import {
    RSITrendingStrategy,
} from '../generated/mai-fund-graph/RSITrendingStrategy';

import {
    fetchFund,
    ZERO_BD,
    ONE_BD,
    BI_18,
    convertToDecimal,
    isUSDCollateral
} from './utils'

import {FundHourData, Rebalance} from '../generated/schema';

import {
    SetManager as SetManagerEvent,
} from '../generated/mai-fund-graph/SocialTradingFund';

import {
    Rebalance as RebalanceEvent,
} from '../generated/mai-fund-graph/AutoTradingFund';


export function handleSetManager(event: SetManagerEvent): void {
    let fund = fetchFund(event.address)
    fund.manager = event.params.newManager.toHexString()
    fund.save()
}

export function handleRebalance(event:RebalanceEvent): void {
    let fund = fetchFund(event.address)
    let transactionHash = event.transaction.hash.toHexString()
    let rebalance = new Rebalance(
        event.address
        .toHexString()
        .concat('-')
        .concat(transactionHash)
    )
    rebalance.fund = fund.id
    rebalance.timestamp = event.block.timestamp.toI32()
    rebalance.side = event.params.side
    rebalance.price = convertToDecimal(event.params.price, BI_18)
    rebalance.amount = convertToDecimal(event.params.amount, BI_18)
    rebalance.save()
}

// block handler for each fund, add new function when new fund created 
export function handleETHPerpFund(block: ethereum.Block): void {
    let fundAddress = Address.fromString("0x38884e823e6f1cd93757ed74b06380b22761a3de")
    handleBlock(block, fundAddress)
}

export function handleBlock(block: ethereum.Block, address: Address): void {
    let fund = fetchFund(address)
    if (fund.state != 0) {
        return
    }
    // hour data
    let timestamp = block.timestamp.toI32()
    let hourIndex = timestamp / 3600
    let hourStartUnix = hourIndex * 3600
    let hourFundID = address.toHexString()
    .concat('-')
    .concat(BigInt.fromI32(hourIndex).toString())
    let fundHourData = FundHourData.load(hourFundID)
    if (fundHourData == null) {
        fundHourData = new FundHourData(hourFundID)
        fundHourData.fund = fund.id
        fundHourData.hourStartUnix = hourStartUnix
        let fundContract = FundContract.bind(address)
        let netAssetValuePerShare = ZERO_BD

        let callResult = fundContract.try_netAssetValuePerShare()
        if(callResult.reverted){
            log.warning("Get try_netAssetValuePerShare reverted at block: {}", [block.number.toString()])
        } else {
            netAssetValuePerShare = convertToDecimal(callResult.value, BI_18)
        }

        let perpetual = Perpetual.bind(Address.fromString(fund.perpetual))
        let markPrice = ONE_BD
        callResult = perpetual.try_markPrice()
        if(callResult.reverted){
            log.warning("Get try_markPrice reverted at block: {}", [block.number.toString()])
        } else {
            markPrice = convertToDecimal(callResult.value, BI_18)
        }

        let netValueInUSD = ZERO_BD
        let netValue = ZERO_BD

        if (isUSDCollateral(fund.collateral)) {
            netValueInUSD = netAssetValuePerShare
            netValue = netAssetValuePerShare.times(markPrice)
        } else {
            netValueInUSD = netAssetValuePerShare.div(markPrice)
            netValue = netAssetValuePerShare
        }
        // rsi strategy for AutoTradingFund
        let nextTarget = ZERO_BD
        let currentRSI = ZERO_BD
        if (fund.RSITrendingStrategy != "") {
            let strategy = RSITrendingStrategy.bind(Address.fromString(fund.RSITrendingStrategy))
            callResult = strategy.try_getCurrentRSI()
            if(callResult.reverted){
                log.warning("Get try_getCurrentRSI reverted at block: {}", [block.number.toString()])
            } else {
                currentRSI = convertToDecimal(callResult.value, BI_18)
            }

            callResult = strategy.try_getNextTarget()
            if(callResult.reverted){
                log.warning("Get try_getNextTarget reverted at block: {}", [block.number.toString()])
            } else {
                nextTarget = convertToDecimal(callResult.value, BI_18)
            }
        }
        fundHourData.netAssetValuePerShare = netAssetValuePerShare
        fundHourData.netAssetValuePerShareUSD = netValueInUSD
        fundHourData.netAssetValuePerShareUnderlying = netValue
        fundHourData.nextTarget = nextTarget
        fundHourData.currentRSI = currentRSI
        fundHourData.save()
    }
}
  