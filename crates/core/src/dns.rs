use hickory_resolver::config::{NameServerConfigGroup, ResolverConfig};
use hickory_resolver::name_server::TokioConnectionProvider;
use hickory_resolver::TokioResolver;
use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::Arc;

/// Some local DNS filters sinkhole mangadex hosts to 127.0.0.1.
/// Resolve through public DNS, falling back to the system resolver.
#[derive(Clone)]
pub struct PublicDns(TokioResolver);

impl PublicDns {
    pub fn new() -> Self {
        let group = NameServerConfigGroup::from_ips_clear(
            &[
                IpAddr::V4(Ipv4Addr::new(1, 1, 1, 1)),
                IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8)),
            ],
            53,
            true,
        );
        let config = ResolverConfig::from_parts(None, vec![], group);
        Self(TokioResolver::builder_with_config(config, TokioConnectionProvider::default()).build())
    }

    pub fn client() -> reqwest::Client {
        reqwest::Client::builder()
            .dns_resolver(Arc::new(Self::new()))
            .user_agent("TruyenvietReader/1.0 (educational demo)")
            .pool_max_idle_per_host(32)
            .build()
            .expect("reqwest client")
    }
}

impl Resolve for PublicDns {
    fn resolve(&self, name: Name) -> Resolving {
        let resolver = self.0.clone();
        Box::pin(async move {
            let host = name.as_str().to_string();
            let ips = match resolver.lookup_ip(host.as_str()).await {
                Ok(l) => l.iter().collect::<Vec<_>>(),
                Err(_) => tokio::net::lookup_host((host.as_str(), 0))
                    .await?
                    .map(|s| s.ip())
                    .collect(),
            };
            let addrs: Vec<SocketAddr> = ips.into_iter().map(|ip| SocketAddr::new(ip, 0)).collect();
            Ok(Box::new(addrs.into_iter()) as Addrs)
        })
    }
}
