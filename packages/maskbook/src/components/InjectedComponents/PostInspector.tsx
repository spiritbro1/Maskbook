import React, { useState, useEffect, useMemo } from 'react'
import { useAsync } from 'react-use'
import { DecryptPost, DecryptPostProps } from './DecryptedPost/DecryptedPost'
import { AddToKeyStore, AddToKeyStoreProps } from './AddToKeyStore'
import Services from '../../extension/service'
import { ProfileIdentifier } from '../../database/type'
import type { Profile } from '../../database'
import { useCurrentIdentity, useFriendsList } from '../DataSource/useActivatedUI'
import { getActivatedUI } from '../../social-network/ui'
import { useValueRef } from '../../utils/hooks/useValueRef'
import { debugModeSetting } from '../../settings/settings'
import { DebugList } from '../DebugModeUI/DebugList'
import type { TypedMessage } from '../../protocols/typed-message'
import type { PluginConfig } from '../../plugins/types'
import { PluginUI } from '../../plugins/plugin'
import { usePostInfoDetails, usePostInfo } from '../DataSource/usePostInfo'
import { ErrorBoundary } from '../shared/ErrorBoundary'

export interface PostInspectorProps {
    onDecrypted(post: TypedMessage, raw: string): void
    needZip(): void
    DecryptPostProps?: Partial<DecryptPostProps>
    DecryptPostComponent?: React.ComponentType<DecryptPostProps>
    AddToKeyStoreProps?: Partial<AddToKeyStoreProps>
    AddToKeyStoreComponent?: React.ComponentType<AddToKeyStoreProps>
}
export function PostInspector(props: PostInspectorProps) {
    const postBy = usePostInfoDetails('postBy')
    const postContent = usePostInfoDetails('postContent')
    const encryptedPost = usePostInfoDetails('postPayload')
    const postId = usePostInfoDetails('postIdentifier')
    const postImages = usePostInfoDetails('postMetadataImages')
    const isDebugging = useValueRef(debugModeSetting)
    const whoAmI = useCurrentIdentity()
    const friends = useFriendsList()
    const [alreadySelectedPreviously, setAlreadySelectedPreviously] = useState<Profile[]>([])
    const provePost = useMemo(() => getActivatedUI().publicKeyDecoder(postContent), [postContent])

    const { value: sharedListOfPost } = useAsync(async () => {
        if (!whoAmI || !whoAmI.identifier.equals(postBy) || !encryptedPost.ok) return []
        const { iv, version } = encryptedPost.val
        return Services.Crypto.getSharedListOfPost(version, iv, postBy)
    }, [postBy, whoAmI, encryptedPost])
    useEffect(() => setAlreadySelectedPreviously(sharedListOfPost ?? []), [sharedListOfPost])

    if (postBy.isUnknown) return <slot />

    const debugInfo = isDebugging ? (
        <DebugList
            items={[
                ['Post by', postBy.userId],
                [
                    'Who am I',
                    whoAmI ? `Nickname ${whoAmI.nickname || 'unknown'}, UserID ${whoAmI.identifier.userId}` : 'Unknown',
                ],
                ['My fingerprint', whoAmI?.linkedPersona?.fingerprint ?? 'Unknown'],
                ['Post ID', postId?.toText() || 'Unknown'],
                ['Post Content', postContent],
                ['Post Attachment Links', JSON.stringify(postImages.values())],
            ]}
        />
    ) : null

    if (encryptedPost.ok || postImages.length) {
        if (!isDebugging) props.needZip()
        const DecryptPostX = props.DecryptPostComponent || DecryptPost
        return withAdditionalContent(
            <DecryptPostX
                onDecrypted={props.onDecrypted}
                requestAppendRecipients={
                    // So should not create new data on version -40
                    encryptedPost.ok && encryptedPost.val.version !== -40
                        ? async (profile) => {
                              const { val } = encryptedPost
                              const { iv, version } = val
                              const ownersAESKeyEncrypted =
                                  val.version === -38 ? val.AESKeyEncrypted : val.ownersAESKeyEncrypted

                              setAlreadySelectedPreviously(alreadySelectedPreviously.concat(profile))
                              return Services.Crypto.appendShareTarget(
                                  version,
                                  ownersAESKeyEncrypted,
                                  iv,
                                  profile.map((x) => x.identifier),
                                  whoAmI!.identifier,
                                  { type: 'direct', at: new Date() },
                              )
                          }
                        : undefined
                }
                alreadySelectedPreviously={alreadySelectedPreviously}
                profiles={friends}
                whoAmI={whoAmI ? whoAmI.identifier : ProfileIdentifier.unknown}
                {...props.DecryptPostProps}
            />,
        )
    } else if (provePost.length) {
        const AddToKeyStoreX = props.AddToKeyStoreComponent || AddToKeyStore
        if (!AddToKeyStoreX) return null
        return withAdditionalContent(
            <AddToKeyStoreX postBy={postBy} provePost={postContent} {...props.AddToKeyStoreProps} />,
        )
    }
    return withAdditionalContent(null)
    function withAdditionalContent(x: JSX.Element | null) {
        return (
            <>
                {encryptedPost.ok ? null : <slot />}
                {x}
                <PluginPostInspector />
                {debugInfo}
            </>
        )
    }
}
function PluginPostInspector() {
    return (
        <>
            {[...PluginUI.values()].map((x) => (
                <ErrorBoundary key={x.identifier}>
                    <PluginPostInspectorForEach config={x} />
                </ErrorBoundary>
            ))}
        </>
    )
}
function PluginPostInspectorForEach({ config }: { config: PluginConfig }) {
    const ref = React.useRef<HTMLDivElement>(null)
    const F = config.postInspector
    const post = usePostInfo()
    React.useEffect(() => {
        if (!ref.current || !F || typeof F === 'function') return
        return F.init(post, {}, ref.current)
    }, [F, post])
    if (!F) return null
    if (typeof F === 'function') return <F />
    return <div ref={ref} />
}