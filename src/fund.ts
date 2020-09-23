import { BigInt, ethereum, log, Address } from "@graphprotocol/graph-ts"
import {
    Purchase as PurchaseEvent,
    Redeem as RedeemEvent,
    Transfer as TransferEvent,
    SetParameter as SetParameterEvent,
    IncreaseRedeemingShareBalance as IncreaseRedeemingShareBalanceEvent,
    DecreaseRedeemingShareBalance as DecreaseRedeemingShareBalanceEvent,
    RequestToRedeem as RequestToRedeemEvent,
    CancelRedeeming as CancelRedeemingEvent,
    Fund as FundContract
} from '../generated/mai-fund-graph/Fund';

import {
    Perpetual,
} from '../generated/mai-fund-graph/Perpetual';

import {
    RSITrendingStrategy,
} from '../generated/mai-fund-graph/RSITrendingStrategy';

import {
    SetManager as SetManagerEvent,
} from '../generated/mai-fund-graph/SocialTradingFund';

import {
    fetchFund,
    fetchUser,
    fetchUserInFund,
    ZERO_BI,
    ZERO_BD,
    ONE_BI,
    ADDRESS_ZERO,
    FUND_LIST,
    isUSDCollateral
} from './utils'

import { Fund, Purchase, Redeem, Redeemed, Transaction, FundHourData } from '../generated/schema';

export function handleSetParameter(event: SetParameterEvent): void {
    let fund = fetchFund(event.address)
    let key = event.params.key.toString()
    if (key == "cap") {
        fund.cap = event.params.value
    } else if (key == "redeemingLockPeriod") {
        fund.redeemingLockPeriod = event.params.value
    } else if (key == "entranceFeeRate") {
        fund.entranceFeeRate = event.params.value
    } else if (key == "streamingFeeRate") {
        fund.streamingFeeRate = event.params.value
    } else if (key == "performanceFeeRate") {
        fund.performanceFeeRate = event.params.value
    } else if (key == "globalRedeemingSlippage") {
        fund.globalRedeemingSlippage = event.params.value
    } else if (key == "drawdownHighWaterMark") {
        fund.drawdownHighWaterMark = event.params.value
    } else if (key == "leverageHighWaterMark") {
        fund.leverageHighWaterMark = event.params.value
    } else if (key == "rebalanceSlippage") {
        fund.rebalanceSlippage = event.params.value
    } else if (key == "rebalanceTolerance") {
        fund.rebalanceTolerance = event.params.value
    }
    fund.save()
}

export function handleSetManager(event: SetManagerEvent): void {
    let fund = fetchFund(event.address)
    fund.manager = event.params.newManager.toHexString()
    fund.save()
}

export function handleTransfer(event:TransferEvent): void {
    let transactionHash = event.transaction.hash.toHexString()
    // user stats
    let from = event.params.from
    let userFrom = fetchUser(from)
    let userInFundFrom = fetchUserInFund(from, event.address)
    let to = event.params.to
    let userTo = fetchUser(to)
    let userInFundTo = fetchUserInFund(to, event.address)
    let fund = fetchFund(event.address)

    let transaction = Transaction.load(transactionHash)
    if (transaction == null) {
        transaction = new Transaction(transactionHash)
        transaction.blockNumber = event.block.number
        transaction.timestamp = event.block.timestamp.toI32()
        transaction.purchases = []
        transaction.redeemeds = []
    }
    // purchase
    if (from.toHexString() == ADDRESS_ZERO) {
        let purchases = transaction.purchases
        if (purchases.length === 0) {
            let purchase = new Purchase(
                event.transaction.hash
                  .toHexString()
                  .concat('-')
                  .concat(BigInt.fromI32(purchases.length).toString())
            )
            purchase.transaction = transaction.id
            purchase.timestamp = transaction.timestamp
            purchase.fund = fund.id
            purchase.to = userTo.id
            purchase.userInFund = userInFundTo.id
            purchase.shareAmount = event.params.value
            purchase.save()

            purchases.push(purchase.id)
            transaction.purchases = purchases
            transaction.save()
        }
    }

    // redeem
    if (to.toHexString() == ADDRESS_ZERO) {
        let redeemeds = transaction.redeemeds
        if (redeemeds.length === 0) {
            let redeemed = new Redeemed(
                event.transaction.hash
                  .toHexString()
                  .concat('-')
                  .concat(BigInt.fromI32(redeemeds.length).toString())
            )
            redeemed.transaction = transaction.id
            redeemed.timestamp = transaction.timestamp
            redeemed.fund = fund.id
            redeemed.from = userFrom.id
            redeemed.userInFund = userInFundFrom.id
            redeemed.shareAmount = event.params.value
            redeemed.save()

            redeemeds.push(redeemed.id)
            transaction.redeemeds = redeemeds
            transaction.save()
        }
    }

    // swap
    if (from.toHexString() != ADDRESS_ZERO && to.toHexString() != ADDRESS_ZERO) {
        let swapedAssetValue = userInFundFrom.assetValue.div(userInFundFrom.shareAmount).times(userInFundFrom.shareAmount.minus(event.params.value))
        userInFundFrom.shareAmount = userInFundFrom.shareAmount.minus(event.params.value)
        userInFundFrom.assetValue = userInFundFrom.assetValue.minus(swapedAssetValue)
        userInFundFrom.save()
    
        userInFundTo.shareAmount = userInFundTo.shareAmount.plus(event.params.value)
        userInFundTo.assetValue = userInFundTo.assetValue.plus(swapedAssetValue)
        userInFundTo.save()
    }
}

export function handlePurchase(event: PurchaseEvent): void {
    let transaction = Transaction.load(event.transaction.hash.toHexString())
    let purchases = transaction.purchases
    let purchase = Purchase.load(purchases[purchases.length - 1])

    purchase.netAssetValuePerShare = event.params.netAssetValuePerShare
    purchase.logIndex = event.logIndex
    purchase.save()


    let userInFund = fetchUserInFund(event.params.account, event.address)
    userInFund.shareAmount = userInFund.shareAmount.plus(event.params.shareAmount)
    userInFund.totalPurchaseValue = userInFund.totalPurchaseValue.plus(event.params.netAssetValuePerShare.times(event.params.shareAmount))
    userInFund.assetValue = userInFund.assetValue.plus(event.params.netAssetValuePerShare.times(event.params.shareAmount))
    userInFund.save()

    let fund = fetchFund(event.address)
    if (fund.totalSupply == ZERO_BI) {
       fund.initNetAssetValuePerShare = event.params.netAssetValuePerShare
       fund.initTimestamp = event.block.timestamp.toI32()
    }
    fund.totalSupply = fund.totalSupply.plus(event.params.shareAmount)
    fund.save()
}

export function handleRedeem(event: RedeemEvent): void {
    let transaction = Transaction.load(event.transaction.hash.toHexString())
    let redeemeds = transaction.redeemeds
    let redeemed = Redeemed.load(redeemeds[redeemeds.length - 1])

    redeemed.returnedCollateral = event.params.returnedCollateral
    redeemed.logIndex = event.logIndex
    redeemed.save()

    let userInFund = fetchUserInFund(event.params.account, event.address)
    userInFund.shareAmount = userInFund.shareAmount.minus(event.params.shareAmount)
    userInFund.assetValue = userInFund.assetValue.minus(event.params.returnedCollateral)
    userInFund.totalRedeemValue = userInFund.totalRedeemValue.plus(event.params.returnedCollateral)
    userInFund.save()

    let fund = fetchFund(event.address)
    fund.totalSupply = fund.totalSupply.minus(event.params.shareAmount)
    fund.save()
}

export function handleIncreaseRedeemingShareBalance(event: IncreaseRedeemingShareBalanceEvent): void {
    let userInFund = fetchUserInFund(event.params.trader, event.address)
    userInFund.redeemingShareAmount = userInFund.redeemingShareAmount.plus(event.params.amount)
    userInFund.save()
}

export function handleDecreaseRedeemingShareBalance(event: DecreaseRedeemingShareBalanceEvent): void {
    let userInFund = fetchUserInFund(event.params.trader, event.address)
    userInFund.redeemingShareAmount = userInFund.redeemingShareAmount.minus(event.params.amount)
    userInFund.save()
}

export function handleRequestToRedeem(event: RequestToRedeemEvent): void {
    let userInFund = fetchUserInFund(event.params.account, event.address)
    let fund = fetchFund(event.address)
    let user = fetchUser(event.params.account)
    let redeem = new Redeem(
          event.params.account
          .toHexString()
          .concat('-')
          .concat(event.transaction.hash.toHexString())
          .concat('-')
          .concat(event.logIndex.toString())
    )
    redeem.timestamp = event.block.timestamp.toI32()
    redeem.fund = fund.id
    redeem.user = user.id
    redeem.type = 0
    redeem.userInFund = userInFund.id
    redeem.shareAmount = event.params.shareAmount
    redeem.slippage = event.params.slippage
    redeem.save()
}

export function handleCancelRedeeming(event:CancelRedeemingEvent): void {
    let userInFund = fetchUserInFund(event.params.account, event.address)
    let fund = fetchFund(event.address)
    let user = fetchUser(event.params.account)
    let redeem = new Redeem(
          event.params.account
          .toHexString()
          .concat('-')
          .concat(event.transaction.hash.toHexString())
          .concat('-')
          .concat(event.logIndex.toString())
    )
    redeem.timestamp = event.block.timestamp.toI32()
    redeem.fund = fund.id
    redeem.user = user.id
    redeem.type = 1
    redeem.userInFund = userInFund.id
    redeem.shareAmount = event.params.shareAmount
    redeem.save()
}

export function handleBlock(block: ethereum.Block): void {
    for (let i = 0; i < FUND_LIST.length; i++) {
        let fund = fetchFund(Address.fromString(FUND_LIST[i]))

        // hour data
        let timestamp = block.timestamp.toI32()
        let hourIndex = timestamp / 3600
        let hourStartUnix = hourIndex * 3600
        let hourFundID = FUND_LIST[i]
        .concat('-')
        .concat(BigInt.fromI32(hourIndex).toString())
        let fundHourData = FundHourData.load(hourFundID)
        if (fundHourData == null) {
            fundHourData = new FundHourData(hourFundID)
            fundHourData.fund = fund.id
            fundHourData.hourStartUnix = hourStartUnix
            let fundContract = FundContract.bind(Address.fromString(FUND_LIST[i]))
            let netAssetValuePerShare = ZERO_BI

            let callResult = fundContract.try_netAssetValuePerShare()
            if(callResult.reverted){
                log.warning("Get try_netAssetValuePerShare reverted at block: {}", [block.number.toString()])
            } else {
                netAssetValuePerShare = callResult.value
            }

            let perpetual = Perpetual.bind(Address.fromString(fund.perpetual))
            let markPrice = ONE_BI
            callResult = perpetual.try_markPrice()
            if(callResult.reverted){
                log.warning("Get try_markPrice reverted at block: {}", [block.number.toString()])
            } else {
                markPrice = callResult.value
            }

            let netValueInUSD = ZERO_BI
            let netValue = ZERO_BI

            if (isUSDCollateral(fund.collateral)) {
                netValueInUSD = netAssetValuePerShare
                netValue = netAssetValuePerShare.times(markPrice)
            } else {
                netValueInUSD = netAssetValuePerShare.div(markPrice)
                netValue = netAssetValuePerShare
            }
            // rsi strategy for AutoTradingFund
            let nextTarget = ZERO_BI
            let currentRSI = ZERO_BI
            if (fund.RSITrendingStrategy != "") {
                let strategy = RSITrendingStrategy.bind(Address.fromString(fund.RSITrendingStrategy))
                callResult = strategy.try_getCurrentRSI()
                if(callResult.reverted){
                    log.warning("Get try_getCurrentRSI reverted at block: {}", [block.number.toString()])
                } else {
                    currentRSI = callResult.value
                }

                callResult = strategy.try_getNextTarget()
                if(callResult.reverted){
                    log.warning("Get try_getNextTarget reverted at block: {}", [block.number.toString()])
                } else {
                    nextTarget = callResult.value
                }

            }
            fundHourData.netAssetValuePerShareUSD = netValueInUSD
            fundHourData.netAssetValuePerShareUnderlying = netValue
            fundHourData.nextTarget = nextTarget
            fundHourData.currentRSI = currentRSI
            fundHourData.save()
        }
    }
}
  
